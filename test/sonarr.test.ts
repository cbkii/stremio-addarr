import test from 'node:test';
import assert from 'node:assert/strict';
import { SonarrClient } from '../src/services/sonarr.js';
import { HttpError } from '../src/lib/http.js';
import { baseConfig } from './_helpers.js';

class FakeHttp {
  constructor(
    private readonly handlers: { get: Record<string, unknown>; post?: Record<string, unknown> },
    private readonly postError?: Error
  ) {}

  async get<T>(path: string): Promise<T> {
    if (!(path in this.handlers.get)) throw new Error(`Missing GET ${path}`);
    return this.handlers.get[path] as T;
  }

  async post<T>(path: string, _body?: unknown): Promise<T> {
    if (this.postError) throw this.postError;
    if (!this.handlers.post || !(path in this.handlers.post)) throw new Error(`Missing POST ${path}`);
    return this.handlers.post[path] as T;
  }
}

test('maps episode downloaded status', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [{ id: 7, seasonNumber: 1, episodeNumber: 2, hasFile: true, monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.state, 'episode_downloaded');
});

test('episode downloaded status includes episodeFileId', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [{ id: 7, seasonNumber: 1, episodeNumber: 2, episodeFileId: 55, monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.state, 'episode_downloaded');
  assert.equal(status.episodeFileId, 55);
});

test('getEpisodeFilePath returns path from Arr API', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const http = {
    async get<T>(reqPath: string): Promise<T> {
      if (reqPath === '/api/v3/episodefile/55') return { path: '/tv/show/ep.mkv' } as T;
      throw new Error(`Unexpected GET ${reqPath}`);
    },
    async post<T>(_reqPath: string): Promise<T> { return {} as T; }
  };

  const client = new SonarrClient(cfg, http as never);
  const filePath = await client.getEpisodeFilePath(55);
  assert.equal(filePath, '/tv/show/ep.mkv');
});

test('getEpisodeFilePath returns null when Arr API fails', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const http = {
    async get<T>(_reqPath: string): Promise<T> { throw new Error('network error'); },
    async post<T>(_reqPath: string): Promise<T> { return {} as T; }
  };

  const client = new SonarrClient(cfg, http as never);
  const filePath = await client.getEpisodeFilePath(55);
  assert.equal(filePath, null);
});

test('duplicate add returns already exists', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({ get: { '/api/v3/series': [{ id: 10, imdbId: 'tt10', title: 'ShowX' }] } }) as never
  );

  const result = await client.addSeriesByImdbId('tt10');
  assert.equal(result.alreadyExisted, true);
});

test('HTTP 400 already-been-added response returns alreadyExisted', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = new FakeHttp(
    {
      get: {
        '/api/v3/series': [],
        '/api/v3/series/lookup?term=imdb%3Att20': [{ title: 'ShowY', imdbId: 'tt20', tvdbId: 200 }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [] }
      }
    },
    new HttpError('bad request', 400, 'This series has already been added')
  );

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt20');
  assert.equal(result.ok, true);
  assert.equal(result.alreadyExisted, true);
});

test('episode cache is cleared after successful add', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  let getCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      getCallCount++;
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path.startsWith('/api/v3/series/lookup')) {
        return [{ title: 'ShowZ', imdbId: 'tt30', tvdbId: 300 }] as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt30');
  assert.equal(result.ok, true);
  // After add, cache is cleared; a subsequent status check should re-fetch series
  const statusGetsBefore = getCallCount;
  await client.getEpisodeStatus('tt30');
  assert.ok(getCallCount > statusGetsBefore, 'Should re-fetch after cache clear');
});

test('episode downloading status takes precedence over missing', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [{ id: 7, seasonNumber: 1, episodeNumber: 2, monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [{ episodeId: 7, seriesId: 22 }] }
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.state, 'episode_downloading');
});

test('triggerEpisodeSearch posts EpisodeSearch command', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99' }] as T;
      if (path === '/api/v3/episode?seriesId=41') {
        return [{ id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt99', tvdbId: 999, title: 'Show99' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body: unknown): Promise<T> {
      posts.push(body);
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(posts[0], { name: 'EpisodeSearch', episodeIds: [55] });
});

test('queue failure does not downgrade episode status to unavailable', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 50, imdbId: 'tt50', title: 'Q' }] as T;
      if (path === '/api/v3/episode?seriesId=50') return [{ id: 501, seasonNumber: 1, episodeNumber: 1, monitored: true }] as T;
      if (path.startsWith('/api/v3/queue?')) throw new Error('queue timeout');
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt50', tvdbId: 50, title: 'Q' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const status = await client.getEpisodeStatus('tt50', 1, 1);
  assert.equal(status.state, 'episode_missing');
});

test('sonarr queue pagination finds match and uses cache', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  let queueCalls = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 60, imdbId: 'tt60', title: 'W' }] as T;
      if (path === '/api/v3/episode?seriesId=60') return [{ id: 601, seasonNumber: 2, episodeNumber: 3, monitored: true }] as T;
      if (path === '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true') {
        queueCalls++;
        return { records: [{ seriesId: 99, episodeId: 999 }], totalRecords: 251 } as T;
      }
      if (path === '/api/v3/queue?page=2&pageSize=250&includeUnknownSeriesItems=true') {
        queueCalls++;
        return { records: [{ seriesId: 60, episodeId: 601 }], totalRecords: 251 } as T;
      }
      if (path === '/api/v3/queue?page=3&pageSize=250&includeUnknownSeriesItems=true') {
        queueCalls++;
        return { records: [] } as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt60', tvdbId: 60, title: 'W' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const first = await client.getEpisodeStatus('tt60', 2, 3);
  const second = await client.getEpisodeStatus('tt60', 2, 3);
  assert.equal(first.state, 'episode_downloading');
  assert.equal(second.state, 'episode_downloading');
  assert.equal(queueCalls, 3);
});

test('triggerEpisodeSearch returns unavailable reason when status lookup fails', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') throw new Error('sonarr unavailable');
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt77', 1, 1);
  assert.equal(result.ok, false);
  assert.equal(result.title, 'Sonarr unavailable');
  assert.match(result.summary, /unavailable/);
});

test('listRecentSeriesImports honors offset paging across pages', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/history?page=1&pageSize=50&sortKey=date&sortDirection=descending&eventType=downloadFolderImported') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ seriesId: i + 1 })) } as T;
      }
      if (path === '/api/v3/history?page=2&pageSize=50&sortKey=date&sortDirection=descending&eventType=downloadFolderImported') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ seriesId: i + 51 })) } as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const records = await client.listRecentSeriesImports(5, 52);
  assert.deepEqual(records.map((record) => record.seriesId), [53, 54, 55, 56, 57]);
});
