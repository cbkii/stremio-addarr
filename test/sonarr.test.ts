import test from 'node:test';
import assert from 'node:assert/strict';
import { SonarrClient } from '../src/services/sonarr.js';
import { baseConfig } from './_helpers.js';

class FakeHttp {
  constructor(private readonly handlers: { get: Record<string, unknown>; post?: Record<string, unknown> }) {}

  async get<T>(path: string): Promise<T> {
    if (!(path in this.handlers.get)) throw new Error(`Missing GET ${path}`);
    return this.handlers.get[path] as T;
  }

  async post<T>(path: string): Promise<T> {
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
