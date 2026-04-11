import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { HttpError } from '../src/lib/http.js';
import { baseConfig } from './_helpers.js';

class FakeHttp {
  constructor(
    private readonly handlers: {
      get: Record<string, unknown>;
      post?: Record<string, unknown>;
      put?: Record<string, unknown>;
    },
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

test('maps downloaded status', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const client = new RadarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/movie': [{ id: 1, imdbId: 'tt1', hasFile: true, monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getMovieStatus('tt1');
  assert.equal(status.state, 'downloaded');
});

test('downloaded status includes movieFileId when movieFile is present', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const client = new RadarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/movie': [{ id: 5, imdbId: 'tt5', movieFile: { id: 99 }, monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getMovieStatus('tt5');
  assert.equal(status.state, 'downloaded');
  assert.equal(status.movieFileId, 99);
});

test('movie release date prefers earliest of physical/digital, then inCinemas fallback', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const client = new RadarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/movie': [{
          id: 5,
          imdbId: 'tt5',
          monitored: true,
          physicalRelease: '2020-05-10',
          digitalRelease: '2020-04-20',
          inCinemas: '2020-01-01'
        }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [] }
      }
    }) as never
  );

  const status = await client.getMovieStatus('tt5');
  assert.equal(status.releaseDate, '2020-04-20');
});

test('getMovieFilePath returns path from Arr API', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const http = {
    async get<T>(reqPath: string): Promise<T> {
      if (reqPath === '/api/v3/moviefile/42') return { path: '/movies/test.mkv' } as T;
      throw new Error(`Unexpected GET ${reqPath}`);
    },
    async post<T>(_reqPath: string): Promise<T> { return {} as T; },
    async put<T>(_reqPath: string): Promise<T> { return {} as T; }
  };

  const client = new RadarrClient(cfg, http as never);
  const filePath = await client.getMovieFilePath(42);
  assert.equal(filePath, '/movies/test.mkv');
});

test('getMovieFilePath returns null when Arr API fails', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const http = {
    async get<T>(_reqPath: string): Promise<T> { throw new Error('network error'); },
    async post<T>(_reqPath: string): Promise<T> { return {} as T; },
    async put<T>(_reqPath: string): Promise<T> { return {} as T; }
  };

  const client = new RadarrClient(cfg, http as never);
  const filePath = await client.getMovieFilePath(42);
  assert.equal(filePath, null);
});

test('prevents duplicate add when already exists', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const client = new RadarrClient(
    cfg,
    new FakeHttp({ get: {
      '/api/v3/movie': [{ id: 1, imdbId: 'tt2', monitored: true }],
      '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [] }
    } }) as never
  );

  const result = await client.addMovieByImdbId('tt2');
  assert.equal(result.alreadyExisted, true);
});

test('HTTP 400 already-been-added response returns alreadyExisted', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = new FakeHttp(
    {
      get: {
        '/api/v3/movie': [],
        '/api/v3/movie/lookup/imdb?imdbId=tt5': [{ title: 'Movie5', imdbId: 'tt5', tmdbId: 555 }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [] }
      }
    },
    new HttpError('bad request', 400, 'This movie has already been added')
  );

  const client = new RadarrClient(cfg, http as never);
  const result = await client.addMovieByImdbId('tt5');
  assert.equal(result.ok, true);
  assert.equal(result.alreadyExisted, true);
});

test('ping classifies auth errors correctly', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = new FakeHttp({ get: {} });
  // Override get to throw an auth error
  (http as { get: (path: string) => Promise<unknown> }).get = async (_path: string) => {
    throw new HttpError('unauthorized', 401, 'Unauthorized');
  };

  const client = new RadarrClient(cfg, http as never);
  const result = await client.ping();
  assert.equal(result.reachable, false);
  assert.equal(result.detail, 'auth_error');
});


test('movie cache is cleared after successful add', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  let getCallCount = 0;

  const http = {
    async get<T>(path: string): Promise<T> {
      getCallCount++;
      if (path === '/api/v3/movie') return [] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path.startsWith('/api/v3/movie/lookup/imdb')) {
        return [{ title: 'Movie Z', imdbId: 'tt42', tmdbId: 42 }] as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const result = await client.addMovieByImdbId('tt42');
  assert.equal(result.ok, true);

  const statusGetsBefore = getCallCount;
  await client.getMovieStatus('tt42');
  assert.ok(getCallCount > statusGetsBefore, 'Should re-fetch /movie after cache clear');
});

test('downloading state takes precedence over missing', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const client = new RadarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/movie': [{ id: 1, imdbId: 'tt77', monitored: true }],
        '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true': { records: [{ movieId: 1 }] }
      }
    }) as never
  );

  const status = await client.getMovieStatus('tt77');
  assert.equal(status.state, 'downloading');
});

test('triggerMovieSearch posts MoviesSearch command for existing movie', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 5, imdbId: 'tt88', monitored: true }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
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
  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt88');
  assert.equal(result.ok, true);
  assert.deepEqual(posts[0], { name: 'MoviesSearch', movieIds: [5] });
});

test('triggerMovieSearch grabs top approved release before command search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 5, imdbId: 'tt88', monitored: true }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path === '/api/v3/release?movieId=5') {
        return [{ guid: 'abc', indexerId: 9, approved: true, rejected: false }] as T;
      }
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
  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt88');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.path, '/api/v3/release');
  assert.deepEqual(calls[0]?.body, { guid: 'abc', indexerId: 9, movieId: 5 });
});

test('triggerMovieSearch prefers download-allowed release with highest weight and passes downloadClientId', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 5, imdbId: 'tt88', monitored: true }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      if (path === '/api/v3/release?movieId=5') {
        return [
          { guid: 'low', indexerId: 3, approved: true, rejected: false, downloadAllowed: true, releaseWeight: 10 },
          { guid: 'best', indexerId: 7, approved: true, rejected: false, downloadAllowed: true, releaseWeight: 100, downloadClientId: 44 },
          { guid: 'blocked', indexerId: 9, approved: true, rejected: false, downloadAllowed: false, releaseWeight: 999 }
        ] as T;
      }
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
  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt88');
  assert.equal(result.ok, true);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    path: '/api/v3/release',
    body: { guid: 'best', indexerId: 7, movieId: 5, downloadClientId: 44 }
  });
});

test('triggerMovieSearch enables movie monitored before searching', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 6, imdbId: 'tt89', monitored: false }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt89');
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [
    { path: '/api/v3/movie/editor', body: { movieIds: [6], monitored: true } },
    { path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [6] } }
  ]);
});

test('queue failure does not downgrade movie status to unavailable', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 15, imdbId: 'tt1515', monitored: true }] as T;
      if (path.startsWith('/api/v3/queue?')) throw new Error('queue timeout');
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const status = await client.getMovieStatus('tt1515');
  assert.equal(status.state, 'missing');
});

test('queue pagination finds matches after first page and caches queue calls', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  let queueCalls = 0;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 16, imdbId: 'tt1616', monitored: true }] as T;
      if (path === '/api/v3/queue?page=1&pageSize=250&includeUnknownMovieItems=true') {
        queueCalls++;
        return { records: [{ movieId: 999 }], totalRecords: 251 } as T;
      }
      if (path === '/api/v3/queue?page=2&pageSize=250&includeUnknownMovieItems=true') {
        queueCalls++;
        return { records: [{ movieId: 16 }], totalRecords: 251 } as T;
      }
      if (path === '/api/v3/queue?page=3&pageSize=250&includeUnknownMovieItems=true') {
        queueCalls++;
        return { records: [] } as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const first = await client.getMovieStatus('tt1616');
  const second = await client.getMovieStatus('tt1616');
  assert.equal(first.state, 'downloading');
  assert.equal(second.state, 'downloading');
  assert.equal(queueCalls, 3);
});

test('triggerMovieSearch returns unavailable reason when status lookup fails', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') throw new Error('radarr unreachable');
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt9999');
  assert.equal(result.ok, false);
  assert.equal(result.title, 'Radarr unavailable');
  assert.match(result.summary, /unreachable/);
});

test('listRecentMovieImports honors offset paging across pages', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/history?page=1&pageSize=50&sortKey=date&sortDirection=descending') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ movieId: i + 1, eventType: 'downloadFolderImported' })) } as T;
      }
      if (path === '/api/v3/history?page=2&pageSize=50&sortKey=date&sortDirection=descending') {
        return { records: Array.from({ length: 50 }, (_, i) => ({ movieId: i + 51, eventType: 'downloadFolderImported' })) } as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string): Promise<T> {
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const records = await client.listRecentMovieImports(5, 52);
  assert.deepEqual(records.map((record) => record.movieId), [53, 54, 55, 56, 57]);
});

test('addMovieByImdbId handles single-object lookup response from Radarr API', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  let capturedBody: Record<string, unknown> | undefined;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      // Radarr /movie/lookup/imdb returns a single object (not an array)
      if (path.startsWith('/api/v3/movie/lookup/imdb')) {
        return { title: 'Single Movie', imdbId: 'tt100', tmdbId: 100 } as T;
      }
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body?: unknown): Promise<T> {
      capturedBody = body as Record<string, unknown>;
      return {} as T;
    }
  };

  const client = new RadarrClient(cfg, http as never);
  const result = await client.addMovieByImdbId('tt100');
  assert.equal(result.ok, true);
  assert.ok(capturedBody, 'POST body should be captured');
  assert.equal(capturedBody.title, 'Single Movie');
  assert.equal(capturedBody.imdbId, 'tt100');
  assert.equal(capturedBody.tmdbId, 100);
});
