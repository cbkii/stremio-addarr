import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { SonarrClient } from '../src/services/sonarr.js';
import { baseConfig } from './_helpers.js';

interface Call { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown }

function radarrHttp(options: {
  movies?: unknown[];
  lookup?: unknown[];
  created?: unknown;
  command?: unknown;
  onCall?: (call: Call) => void;
}) {
  return {
    async get<T>(path: string): Promise<T> {
      options.onCall?.({ method: 'GET', path });
      if (path === '/api/v3/movie') return (options.movies ?? []) as T;
      if (path.startsWith('/api/v3/movie/lookup')) return (options.lookup ?? []) as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'POST', path, body });
      if (path === '/api/v3/movie') return (options.created ?? {}) as T;
      if (path === '/api/v3/command') return (options.command ?? { id: 1 }) as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'PUT', path, body });
      return {} as T;
    }
  };
}

test('Radarr extend preserves P4 and only enables monitoring before exact search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.existingItemPolicy = 'extend';
  cfg.radarr.qualityProfileId = 1;
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 10, imdbId: 'tt10', title: 'Movie', monitored: false, qualityProfileId: 4 }],
    command: { id: 101 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt10');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.method !== 'GET'), [
    { method: 'PUT', path: '/api/v3/movie/editor', body: { movieIds: [10], monitored: true } },
    { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [10] } }
  ]);
});

test('Radarr apply-config explicitly replaces owned fields then exact-searches', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.existingItemPolicy = 'apply-config';
  cfg.radarr.qualityProfileId = 2;
  cfg.radarr.minimumAvailability = 'released';
  cfg.radarr.rootFolderPath = '/new-movies';
  cfg.radarr.tags = [2, 5];
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 11, imdbId: 'tt11', title: 'Movie', monitored: false, qualityProfileId: 4 }],
    command: { id: 102 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt11');
  assert.equal(result.ok, true);
  const editor = calls.find((call) => call.path === '/api/v3/movie/editor');
  assert.deepEqual(editor?.body, {
    movieIds: [11], monitored: true, qualityProfileId: 2,
    minimumAvailability: 'released', rootFolderPath: '/new-movies',
    tags: [2, 5], applyTags: 'replace', moveFiles: false
  });
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [11] } });
});

test('Radarr TMDB fallback finds an existing movie without IMDb ID', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Call[] = [];
  const tmdb = {
    async getMovieTmdbId() { return 900; },
    async getMovieReleaseDate() { return undefined; }
  };
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 90, tmdbId: 900, title: 'TMDB Movie', monitored: true }],
    command: { id: 103 },
    onCall: (call) => calls.push(call)
  }) as never, tmdb as never);

  const result = await client.triggerMovieSearch('tt900');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.body, { name: 'MoviesSearch', movieIds: [90] });
});

test('new Radarr POST ID bypasses stale list visibility and gets one exact search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [],
    lookup: [{ title: 'New Movie', imdbId: 'tt91', tmdbId: 91, year: 2026 }],
    created: { id: 91, title: 'New Movie', imdbId: 'tt91', tmdbId: 91 },
    command: { id: 104 },
    onCall: (call) => calls.push(call)
  }) as never);

  const added = await client.addMovieByImdbId('tt91');
  assert.equal(added.itemId, 91);
  const searched = await client.triggerMovieSearch('tt91', {
    existingBeforeAction: false,
    knownMovieId: added.itemId,
    knownTitle: added.detail
  });
  assert.equal(searched.ok, true);
  assert.equal(calls.filter((call) => call.path === '/api/v3/movie').length, 2); // one GET + one POST
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command'), [
    { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [91] } }
  ]);
});

function sonarrHttp(options: {
  series?: unknown[];
  lookup?: unknown[];
  episodes?: unknown[];
  created?: unknown;
  command?: unknown;
  onCall?: (call: Call) => void;
}) {
  return {
    async get<T>(path: string): Promise<T> {
      options.onCall?.({ method: 'GET', path });
      if (path === '/api/v3/series') return (options.series ?? []) as T;
      if (path.startsWith('/api/v3/series/lookup')) return (options.lookup ?? []) as T;
      if (path.startsWith('/api/v3/episode?seriesId=')) return (options.episodes ?? []) as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'POST', path, body });
      if (path === '/api/v3/series') return (options.created ?? {}) as T;
      if (path === '/api/v3/command') return (options.command ?? { id: 1 }) as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'PUT', path, body });
      return {} as T;
    }
  };
}

test('Sonarr extend is additive and never narrows other episode monitoring', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'extend';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 20, imdbId: 'tt20', title: 'Show', monitored: false, qualityProfileId: 4, monitorNewItems: 'all' }],
    episodes: [
      { id: 201, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 202, seasonNumber: 1, episodeNumber: 2, monitored: false },
      { id: 203, seasonNumber: 1, episodeNumber: 3, monitored: true }
    ],
    command: { id: 2010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt20', 1, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.method === 'PUT'), [
    { method: 'PUT', path: '/api/v3/series/editor', body: { seriesIds: [20], monitored: true } },
    { method: 'PUT', path: '/api/v3/episode/monitor', body: { episodeIds: [202], monitored: true } }
  ]);
  assert.ok(!calls.some((call) => call.method === 'PUT' && (call.body as any)?.monitored === false));
});

test('Sonarr apply-config scoped mode is destructive only after explicit opt-in', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'apply-config';
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.qualityProfileId = 2;
  cfg.sonarr.monitorNewItems = 'none';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 21, imdbId: 'tt21', title: 'Show', monitored: true, qualityProfileId: 4, monitorNewItems: 'all' }],
    episodes: [
      { id: 211, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 212, seasonNumber: 1, episodeNumber: 2, monitored: true }
    ],
    command: { id: 2110 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt21', 1, 2);
  assert.equal(result.ok, true);
  assert.ok(calls.some((call) => call.path === '/api/v3/series/editor' && (call.body as any).qualityProfileId === 2));
  assert.ok(calls.some((call) => call.path === '/api/v3/episode/monitor' && (call.body as any).monitored === false));
  assert.deepEqual(calls.at(-1)?.body, { name: 'EpisodeSearch', episodeIds: [212] });
});

test('Sonarr TVDB fallback finds a series without IMDb ID', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 30, tvdbId: 777, title: 'TVDB Show', monitored: true }],
    lookup: [{ imdbId: 'tt777', tvdbId: 777, title: 'TVDB Show' }],
    episodes: [{ id: 301, seasonNumber: 2, episodeNumber: 4, monitored: true }],
    command: { id: 3010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt777', 2, 4);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.body, { name: 'EpisodeSearch', episodeIds: [301] });
});

test('new Sonarr POST ID bypasses stale series list and exact-searches selected episode', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'all';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [],
    lookup: [{ title: 'New Show', imdbId: 'tt40', tvdbId: 40, year: 2026 }],
    created: { id: 40, title: 'New Show', imdbId: 'tt40', tvdbId: 40 },
    episodes: [{ id: 401, seasonNumber: 1, episodeNumber: 1, monitored: true }],
    command: { id: 4010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const added = await client.addSeriesByImdbId('tt40', { season: 1, episode: 1 });
  assert.equal(added.itemId, 40);
  const searched = await client.triggerEpisodeSearch('tt40', 1, 1, {
    existingBeforeAction: false,
    knownSeriesId: added.itemId,
    knownTitle: added.detail
  });
  assert.equal(searched.ok, true);
  assert.equal(calls.filter((call) => call.path === '/api/v3/series').length, 2); // one GET + one POST
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command'), [
    { method: 'POST', path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [401] } }
  ]);
});


test('Radarr rejects a command acknowledgement for the wrong command name', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 50, imdbId: 'tt50', title: 'Wrong Command Movie', monitored: true }],
    command: { id: 500, name: 'EpisodeSearch', status: 'queued' }
  }) as never);

  const result = await client.triggerMovieSearch('tt50');
  assert.equal(result.ok, false);
  assert.match(result.summary, /MoviesSearch acknowledgement/i);
});

test('Sonarr rejects a command acknowledgement for the wrong command name', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 60, imdbId: 'tt60', title: 'Wrong Command Show', monitored: true }],
    episodes: [{ id: 601, seasonNumber: 1, episodeNumber: 1, monitored: true }],
    command: { id: 600, name: 'MoviesSearch', status: 'queued' }
  }) as never);

  const result = await client.triggerEpisodeSearch('tt60', 1, 1);
  assert.equal(result.ok, false);
  assert.match(result.summary, /EpisodeSearch acknowledgement/i);
});
