import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { SonarrClient } from '../src/services/sonarr.js';
import { baseConfig } from './_helpers.js';

test('existing Sonarr preserve policy keeps P4/all/new monitoring and queues exact episode search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.qualityProfileId = 1;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.existingItemPolicy = 'preserve';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{
        id: 22,
        imdbId: 'tt22',
        tvdbId: 222,
        title: 'SeriesXYZ',
        monitored: true,
        qualityProfileId: 4,
        monitorNewItems: 'all',
        seasons: [{ seasonNumber: 1, monitored: true }]
      }] as T;
      if (path === '/api/v3/episode?seriesId=22') return [{ id: 7, seasonNumber: 1, episodeNumber: 2, monitored: true }] as T;
      if (path === '/api/v3/qualityprofile') return [{ id: 4, name: 'Existing P4' }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'POST', path, body });
      return { id: 202, name: 'EpisodeSearch', status: 'queued' } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'PUT', path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt22', 1, 2);
  assert.equal(result.ok, true);
  assert.equal(result.commandId, 202);
  assert.deepEqual(calls, [{ method: 'POST', path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [7] } }]);
  assert.match(result.detail ?? '', /preserved/i);
});

test('existing unmonitored Sonarr episode remains unmonitored but exact search is queued', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'preserve';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const puts: unknown[] = [];
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 30, imdbId: 'tt30', title: 'Unmonitored', monitored: false, qualityProfileId: 4, monitorNewItems: 'none' }] as T;
      if (path === '/api/v3/episode?seriesId=30') return [{ id: 31, seasonNumber: 2, episodeNumber: 3, monitored: false }] as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body: unknown): Promise<T> { posts.push(body); return { id: 303 } as T; },
    async put<T>(_path: string, body: unknown): Promise<T> { puts.push(body); return {} as T; }
  };
  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt30', 2, 3);
  assert.equal(result.ok, true);
  assert.equal(puts.length, 0);
  assert.deepEqual(posts, [{ name: 'EpisodeSearch', episodeIds: [31] }]);
});

test('Sonarr exact episode timeout does not fall back to broad search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 4;
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 40, imdbId: 'tt40', title: 'Not Ready' }] as T;
      if (path === '/api/v3/episode?seriesId=40') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body: unknown): Promise<T> { posts.push(body); return { id: 404 } as T; },
    async put<T>(): Promise<T> { return {} as T; }
  };
  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt40', 1, 1);
  assert.equal(result.ok, false);
  assert.equal(posts.length, 0);
  assert.match(result.summary, /No broad search was started/i);
});
