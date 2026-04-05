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
    },
    private readonly postError?: Error
  ) {}

  async get<T>(path: string): Promise<T> {
    if (!(path in this.handlers.get)) throw new Error(`Missing GET ${path}`);
    return this.handlers.get[path] as T;
  }

  async post<T>(path: string): Promise<T> {
    if (this.postError) throw this.postError;
    if (!this.handlers.post || !(path in this.handlers.post)) throw new Error(`Missing POST ${path}`);
    return this.handlers.post[path] as T;
  }
}

test('maps downloaded status', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const client = new RadarrClient(
    cfg,
    new FakeHttp({
      get: {
        '/api/v3/movie': [{ id: 1, imdbId: 'tt1', hasFile: true, monitored: true }]
      }
    }) as never
  );

  const status = await client.getMovieStatus('tt1');
  assert.equal(status.state, 'downloaded');
});

test('prevents duplicate add when already exists', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const client = new RadarrClient(
    cfg,
    new FakeHttp({ get: { '/api/v3/movie': [{ id: 1, imdbId: 'tt2', monitored: true }] } }) as never
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
        '/api/v3/movie/lookup/imdb?imdbId=tt5': [{ title: 'Movie5', imdbId: 'tt5', tmdbId: 555 }]
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
