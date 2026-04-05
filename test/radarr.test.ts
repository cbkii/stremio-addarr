import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { baseConfig } from './_helpers.js';

class FakeHttp {
  constructor(
    private readonly handlers: {
      get: Record<string, unknown>;
      post?: Record<string, unknown>;
    }
  ) {}

  async get<T>(path: string): Promise<T> {
    if (!(path in this.handlers.get)) throw new Error(`Missing GET ${path}`);
    return this.handlers.get[path] as T;
  }

  async post<T>(path: string): Promise<T> {
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
