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

  async post<T>(path: string): Promise<T> {
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
        '/api/v3/episode?seriesId=22': [{ id: 7, seasonNumber: 1, episodeNumber: 2, hasFile: true, monitored: true }]
      }
    }) as never
  );

  const status = await client.getEpisodeStatus('tt9', 1, 2);
  assert.equal(status.state, 'episode_downloaded');
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
        '/api/v3/series/lookup?term=imdb%3Att20': [{ title: 'ShowY', imdbId: 'tt20', tvdbId: 200 }]
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
