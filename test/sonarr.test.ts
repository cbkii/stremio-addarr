import test from 'node:test';
import assert from 'node:assert/strict';
import { SonarrClient } from '../src/services/sonarr.js';
import { HttpError } from '../src/lib/http.js';
import { baseConfig } from './_helpers.js';

class FakeHttp {
  constructor(
    private readonly handlers: { get: Record<string, unknown>; post?: Record<string, unknown>; put?: Record<string, unknown> },
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

  async put<T>(path: string, _body?: unknown): Promise<T> {
    if (!this.handlers.put || !(path in this.handlers.put)) throw new Error(`Missing PUT ${path}`);
    return this.handlers.put[path] as T;
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

test('episode release date prefers airDate (broadcast date) over airDateUtc', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [{
          id: 7,
          seasonNumber: 1,
          episodeNumber: 2,
          monitored: true,
          airDateUtc: '2024-01-10T00:00:00Z',
          airDate: '2024-01-08'
        }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.episodeReleaseDate, '2024-01-08');
});

test('episode release date uses airDate even when it is later than airDateUtc', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const client = new SonarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/series': [{ id: 22, imdbId: 'tt9', title: 'Show' }],
        '/api/v3/episode?seriesId=22': [{
          id: 7,
          seasonNumber: 1,
          episodeNumber: 2,
          monitored: true,
          airDateUtc: '2024-01-08T23:00:00Z',
          airDate: '2024-01-09'
        }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownSeriesItems=true': { records: [] }
      }
    }) as never
  );

  // airDate (2024-01-09) is the broadcast date and is preferred even though
  // airDateUtc (2024-01-08T23:00:00Z) resolves to an earlier UTC timestamp.
  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.episodeReleaseDate, '2024-01-09');
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
    ,
    async put<T>(_reqPath: string): Promise<T> { return {} as T; }
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
    async post<T>(_reqPath: string): Promise<T> { return {} as T; },
    async put<T>(_reqPath: string): Promise<T> { return {} as T; }
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
    },
    async put<T>(_path: string): Promise<T> {
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

test('addSeriesByImdbId applies ep mode monitoring to selected episode only', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 77, imdbId: 'tt771', title: 'ShowEP' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowEP', imdbId: 'tt771', tvdbId: 771 }] as T;
      if (path === '/api/v3/episode?seriesId=77') {
        return [
          { id: 1001, seasonNumber: 1, episodeNumber: 1 },
          { id: 1002, seasonNumber: 1, episodeNumber: 2 },
          { id: 1003, seasonNumber: 1, episodeNumber: 3 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt771', { season: 1, episode: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [1001, 1002, 1003], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [1002], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [77], monitored: true, monitorNewItems: 'none' } }
  ]);
});

test('addSeriesByImdbId applies epfuture mode monitoring for selected and later episodes', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epfuture';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 88, imdbId: 'tt772', title: 'ShowFuture' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowFuture', imdbId: 'tt772', tvdbId: 772 }] as T;
      if (path === '/api/v3/episode?seriesId=88') {
        return [
          { id: 2001, seasonNumber: 1, episodeNumber: 1 },
          { id: 2002, seasonNumber: 1, episodeNumber: 2 },
          { id: 2003, seasonNumber: 2, episodeNumber: 1 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt772', { season: 1, episode: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [2001, 2002, 2003], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [2002, 2003], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [88], monitored: true, monitorNewItems: 'all' } }
  ]);
});

test('addSeriesByImdbId applies epseason mode monitoring for selected episode through season end', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epseason';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 99, imdbId: 'tt773', title: 'ShowSeason' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowSeason', imdbId: 'tt773', tvdbId: 773 }] as T;
      if (path === '/api/v3/episode?seriesId=99') {
        return [
          { id: 3001, seasonNumber: 2, episodeNumber: 1 },
          { id: 3002, seasonNumber: 2, episodeNumber: 2 },
          { id: 3003, seasonNumber: 2, episodeNumber: 3 },
          { id: 3004, seasonNumber: 3, episodeNumber: 1 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt773', { season: 2, episode: 2 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [3001, 3002, 3003, 3004], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [3002, 3003], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [99], monitored: true, monitorNewItems: 'none' } }
  ]);
});

test('ep mode upgrades to EP_COUNT_MOD when prior downloaded episodes threshold is met', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.epCount = 2;
  cfg.sonarr.epCountMod = 'epseason';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 66, imdbId: 'tt776', title: 'ShowCount' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowCount', imdbId: 'tt776', tvdbId: 776 }] as T;
      if (path === '/api/v3/episode?seriesId=66') {
        return [
          { id: 6001, seasonNumber: 1, episodeNumber: 7, hasFile: true },
          { id: 6002, seasonNumber: 1, episodeNumber: 8, hasFile: true },
          { id: 6003, seasonNumber: 1, episodeNumber: 9 },
          { id: 6004, seasonNumber: 1, episodeNumber: 10 },
          { id: 6005, seasonNumber: 2, episodeNumber: 1 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt776', { season: 1, episode: 9 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [6001, 6002, 6003, 6004, 6005], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [6003, 6004], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [66], monitored: true, monitorNewItems: 'none' } }
  ]);
});

test('SONARR_MONITOR_NEW_ITEMS override is honored for scoped mode', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.monitorNewItems = 'all';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 67, imdbId: 'tt777', title: 'ShowOverride' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowOverride', imdbId: 'tt777', tvdbId: 777 }] as T;
      if (path === '/api/v3/episode?seriesId=67') {
        return [{ id: 7001, seasonNumber: 1, episodeNumber: 1 }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt777', { season: 1, episode: 1 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts[2], { path: '/api/v3/series/editor', body: { seriesIds: [67], monitored: true, monitorNewItems: 'all' } });
});

test('ep mode remains ep when EP_COUNT threshold is not met', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.epCount = 3;
  cfg.sonarr.epCountMod = 'epfuture';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 68, imdbId: 'tt778', title: 'ShowNoUpgrade' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowNoUpgrade', imdbId: 'tt778', tvdbId: 778 }] as T;
      if (path === '/api/v3/episode?seriesId=68') {
        return [
          { id: 8001, seasonNumber: 1, episodeNumber: 7, hasFile: true },
          { id: 8002, seasonNumber: 1, episodeNumber: 8, hasFile: false },
          { id: 8003, seasonNumber: 1, episodeNumber: 9 },
          { id: 8004, seasonNumber: 1, episodeNumber: 10 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt778', { season: 1, episode: 9 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts[1], { path: '/api/v3/episode/monitor', body: { episodeIds: [8003], monitored: true } });
});

test('ep mode modifier is disabled when EP_COUNT <= 1', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.epCount = 1;
  cfg.sonarr.epCountMod = 'epfuture';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 69, imdbId: 'tt779', title: 'ShowDisabled' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowDisabled', imdbId: 'tt779', tvdbId: 779 }] as T;
      if (path === '/api/v3/episode?seriesId=69') {
        return [
          { id: 9001, seasonNumber: 1, episodeNumber: 1, hasFile: true },
          { id: 9002, seasonNumber: 1, episodeNumber: 2, hasFile: true },
          { id: 9003, seasonNumber: 1, episodeNumber: 3 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt779', { season: 1, episode: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(puts[1], { path: '/api/v3/episode/monitor', body: { episodeIds: [9003], monitored: true } });
});

test('EP_COUNT_PAST limits the prior-episode window used by ep modifier', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.epCount = 2;
  cfg.sonarr.epCountPast = 2;
  cfg.sonarr.epCountMod = 'epfuture';

  const puts: Array<{ path: string; body: unknown }> = [];
  let seriesCallCount = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        seriesCallCount += 1;
        return (seriesCallCount === 1 ? [] : [{ id: 70, imdbId: 'tt780', title: 'ShowWindow' }]) as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ title: 'ShowWindow', imdbId: 'tt780', tvdbId: 780 }] as T;
      if (path === '/api/v3/episode?seriesId=70') {
        return [
          { id: 10001, seasonNumber: 1, episodeNumber: 5, hasFile: true },  // outside EP_COUNT_PAST window
          { id: 10002, seasonNumber: 1, episodeNumber: 6, hasFile: false },
          { id: 10003, seasonNumber: 1, episodeNumber: 7, hasFile: true },
          { id: 10004, seasonNumber: 1, episodeNumber: 8 }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> { return {} as T; },
    async put<T>(path: string, body: unknown): Promise<T> {
      puts.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt780', { season: 1, episode: 8 });
  assert.equal(result.ok, true);
  // If EP_COUNT_PAST were ignored, this would upgrade to epfuture and include 10004 only.
  assert.deepEqual(puts[1], { path: '/api/v3/episode/monitor', body: { episodeIds: [10004], monitored: true } });
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
    },
    async put<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(posts[0], { name: 'EpisodeSearch', episodeIds: [55] });
});

test('triggerEpisodeSearch with epfuture uses scoped monitoring then MissingEpisodeSearch', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epfuture';
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99' }] as T;
      if (path === '/api/v3/episode?seriesId=41') {
        return [
          { id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true },
          { id: 56, seasonNumber: 3, episodeNumber: 3, monitored: false },
          { id: 57, seasonNumber: 4, episodeNumber: 1, monitored: false }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt99', tvdbId: 999, title: 'Show99' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [55, 56, 57], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [55, 56, 57], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [41], monitored: true, monitorNewItems: 'all' } },
    { path: '/api/v3/command', body: { name: 'MissingEpisodeSearch', seriesId: 41 } }
  ]);
});

test('triggerEpisodeSearch grabs top approved release before command search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99' }] as T;
      if (path === '/api/v3/episode?seriesId=41') {
        return [{ id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path === '/api/v3/release?seriesId=41&seasonNumber=3&episodeId=55') {
        return [{ guid: 'sonarr-guid', indexerId: 11, approved: true, rejected: false }] as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt99', tvdbId: 999, title: 'Show99' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    },
    async put<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/api/v3/release');
  assert.deepEqual(calls[0]?.body, { guid: 'sonarr-guid', indexerId: 11, episodeIds: [55] });
});

test('triggerEpisodeSearch with epseason queues SeasonSearch', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epseason';
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 77, imdbId: 'tt98', title: 'Show98' }] as T;
      if (path === '/api/v3/episode?seriesId=77') {
        return [
          { id: 80, seasonNumber: 2, episodeNumber: 5, monitored: true },
          { id: 81, seasonNumber: 2, episodeNumber: 6, monitored: false },
          { id: 82, seasonNumber: 3, episodeNumber: 1, monitored: false }
        ] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt98', tvdbId: 998, title: 'Show98' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt98', 2, 5);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { path: '/api/v3/episode/monitor', body: { episodeIds: [80, 81, 82], monitored: false } },
    { path: '/api/v3/episode/monitor', body: { episodeIds: [80, 81], monitored: true } },
    { path: '/api/v3/series/editor', body: { seriesIds: [77], monitored: true, monitorNewItems: 'none' } },
    { path: '/api/v3/command', body: { name: 'SeasonSearch', seriesId: 77, seasonNumber: 2 } }
  ]);
});

test('triggerEpisodeSearch prefers download-allowed release with highest weight and passes downloadClientId', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99' }] as T;
      if (path === '/api/v3/episode?seriesId=41') {
        return [{ id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path === '/api/v3/release?seriesId=41&seasonNumber=3&episodeId=55') {
        return [
          { guid: 'low', indexerId: 1, approved: true, rejected: false, downloadAllowed: true, releaseWeight: 10 },
          { guid: 'best', indexerId: 2, approved: true, rejected: false, downloadAllowed: true, releaseWeight: 100, downloadClientId: 88 },
          { guid: 'blocked', indexerId: 3, approved: true, rejected: false, downloadAllowed: false, releaseWeight: 999 }
        ] as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) return [{ imdbId: 'tt99', tvdbId: 999, title: 'Show99' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    },
    async put<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    path: '/api/v3/release',
    body: { guid: 'best', indexerId: 2, episodeIds: [55], downloadClientId: 88 }
  });
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
      if (path === '/api/v3/history?page=1&pageSize=50&sortKey=date&sortDirection=descending') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ seriesId: i + 1, eventType: 'downloadFolderImported' })) } as T;
      }
      if (path === '/api/v3/history?page=2&pageSize=50&sortKey=date&sortDirection=descending') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ seriesId: i + 51, eventType: 'downloadFolderImported' })) } as T;
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

test('addSeriesByImdbId sends addOptions.monitor in payload', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'future';
  let capturedBody: Record<string, unknown> | undefined;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/series/lookup')) {
        return [{ title: 'TestShow', imdbId: 'tt999', tvdbId: 999 }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body?: unknown): Promise<T> {
      capturedBody = body as Record<string, unknown>;
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt999');
  assert.equal(result.ok, true);
  assert.ok(capturedBody, 'POST body should be captured');
  const addOptions = capturedBody!.addOptions as Record<string, unknown>;
  assert.equal(addOptions.monitor, 'future', 'addOptions.monitor should match seriesMonitor config');
  assert.equal(addOptions.searchForMissingEpisodes, true);
  assert.equal(capturedBody!.monitorNewItems, 'all');
});

test('addSeriesByImdbId omits languageProfileId when null (Sonarr v4)', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.languageProfileId = null;
  let capturedBody: Record<string, unknown> | undefined;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/series/lookup')) {
        return [{ title: 'ShowV4', imdbId: 'tt2000', tvdbId: 2000 }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body?: unknown): Promise<T> {
      capturedBody = body as Record<string, unknown>;
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt2000');
  assert.equal(result.ok, true);
  assert.ok(capturedBody, 'POST body should be captured');
  assert.equal(capturedBody!.languageProfileId, undefined, 'languageProfileId should not be sent for Sonarr v4');
});

test('addSeriesByImdbId includes languageProfileId when set (Sonarr v3)', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.languageProfileId = 3;
  let capturedBody: Record<string, unknown> | undefined;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [] as T;
      if (path.startsWith('/api/v3/series/lookup')) {
        return [{ title: 'ShowV3', imdbId: 'tt3000', tvdbId: 3000 }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body?: unknown): Promise<T> {
      capturedBody = body as Record<string, unknown>;
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.addSeriesByImdbId('tt3000');
  assert.equal(result.ok, true);
  assert.ok(capturedBody, 'POST body should be captured');
  assert.equal(capturedBody!.languageProfileId, 3, 'languageProfileId should be sent for Sonarr v3');
});

test('isEpisodeQueued only matches by episodeId — does not false-positive on other episodes from same series', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 5, title: 'Show', imdbId: 'tt4000' }] as T;
      if (path.startsWith('/api/v3/episode')) {
        return [{ id: 77, seasonNumber: 1, episodeNumber: 2, monitored: true, hasFile: false }] as T;
      }
      // Queue has a record for the same series but a different episode (no episodeId set)
      if (path.startsWith('/api/v3/queue?')) {
        return { records: [{ seriesId: 5, episodeId: null }], totalRecords: 1 } as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const status = await client.getEpisodeStatus('tt4000', 1, 2);
  // Should be episode_missing (not episode_downloading), because the queue record has a
  // different episode (episodeId null means it's a full-series grab, not this specific episode)
  assert.equal(status.state, 'episode_missing', 'series-level queue item should not mark a specific episode as downloading');
});

test('findSeriesByImdbId title+year fallback rejects same title different year', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        // Library has a show with same title but different year
        return [{ id: 1, title: 'Duplicate Show', imdbId: 'tt9001', tvdbId: 9001, year: 2015 }] as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) {
        // Lookup returns no tvdbId match — relies on title+year fallback
        return [{ title: 'Duplicate Show', imdbId: 'tt9002', year: 2022 }] as T;
      }
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    }
  };

  const client = new SonarrClient(cfg, http as never);
  // tt9002 has lookup year=2022, library has year=2015 — should NOT match
  const status = await client.getEpisodeStatus('tt9002', 1, 1);
  assert.equal(status.state, 'series_not_added', 'different year should prevent title-only false-positive match');
});

test('findSeriesByImdbId title+year fallback matches when both match', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') {
        return [{ id: 2, title: 'Real Show', imdbId: 'tt0000', tvdbId: undefined, year: 2010, monitored: true }] as T;
      }
      if (path.startsWith('/api/v3/series/lookup')) {
        // No tvdbId — only title+year available for fallback
        return [{ title: 'Real Show', imdbId: 'tt9003', year: 2010 }] as T;
      }
      if (path.startsWith('/api/v3/episode')) return [] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    }
  };

  const client = new SonarrClient(cfg, http as never);
  // tt9003 has lookup year=2010, library has year=2010 — should match
  const status = await client.getEpisodeStatus('tt9003', 1, 1);
  assert.notEqual(status.state, 'series_not_added', 'matching title and year should find the series in library');
});
