import test from 'node:test';
import assert from 'node:assert/strict';
import { ArrStatusService } from '../src/services/status.js';
import type { AppConfig } from '../src/config.js';
import type { ParsedStremioId } from '../src/types.js';

function makeConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    host: '0.0.0.0',
    port: 7010,
    publicBaseUrl: 'http://127.0.0.1:7010',
    publicUrlValidation: { isHttps: false, isLocalhost: true, warnings: [] },
    logLevel: 'error',
    requestTimeoutMs: 1000,
    statusCacheTtlMs: 5000,
    actionConfirm: false,
    radarr: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:7878',
      apiKey: 'test-key',
      rootFolderPath: '/media/movies',
      qualityProfileId: 1,
      minimumAvailability: 'announced',
      tags: [],
      searchOnAdd: true
    },
    sonarr: {
      enabled: false,
      baseUrl: 'http://127.0.0.1:8989',
      apiKey: 'test-key',
      rootFolderPath: '/media/tv',
      qualityProfileId: 1,
      languageProfileId: 1,
      seriesMonitor: 'all',
      tags: [],
      searchOnAdd: true
    },
    ...overrides
  };
}

function movieId(imdbId: string): ParsedStremioId {
  return { rawId: imdbId, imdbId, kind: 'movie', videoId: imdbId };
}

function seriesId(imdbId: string, season: number, episode: number): ParsedStremioId {
  const rawId = `${imdbId}:${season}:${episode}`;
  return { rawId, imdbId, kind: 'series', season, episode, videoId: rawId };
}

test('buildTiles: returns empty array when radarr disabled for movie', async () => {
  const config = makeConfig({ radarr: { ...makeConfig().radarr, enabled: false } });
  const service = new ArrStatusService(config);
  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 0);
});

test('buildTiles: returns empty array when sonarr disabled for series', async () => {
  const config = makeConfig({ sonarr: { ...makeConfig().sonarr, enabled: false } });
  const service = new ArrStatusService(config);
  const tiles = await service.buildTiles(seriesId('tt0000001', 1, 1));
  assert.equal(tiles.length, 0);
});

test('buildTiles: movie unavailable tile has name Radarr', async () => {
  const config = makeConfig({
    radarr: { ...makeConfig().radarr, enabled: true }
  });
  const service = new ArrStatusService(config);

  // Patch getMovieStatus to return unavailable
  const radarrClient = service.getRadarrClient();
  (radarrClient as unknown as Record<string, unknown>).getMovieStatus = async () => ({
    state: 'unavailable',
    reason: 'test'
  });

  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Radarr');
  assert.ok(tiles[0].description.includes('Unavailable'));
});

test('buildTiles: movie downloaded tile has name Radarr and correct description', async () => {
  const config = makeConfig({
    radarr: { ...makeConfig().radarr, enabled: true }
  });
  const service = new ArrStatusService(config);

  const radarrClient = service.getRadarrClient();
  (radarrClient as unknown as Record<string, unknown>).getMovieStatus = async () => ({
    state: 'downloaded',
    monitored: true,
    hasFile: true
  });

  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Radarr');
  assert.equal(tiles[0].description, 'Radarr • Downloaded');
  assert.equal(tiles[0].externalUrl, undefined);
});

test('buildTiles: movie not_added tile has action URL', async () => {
  const config = makeConfig({
    radarr: { ...makeConfig().radarr, enabled: true }
  });
  const service = new ArrStatusService(config);

  const radarrClient = service.getRadarrClient();
  (radarrClient as unknown as Record<string, unknown>).getMovieStatus = async () => ({
    state: 'not_added'
  });

  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Radarr');
  assert.equal(tiles[0].description, 'Add to Radarr + Search');
  assert.ok(tiles[0].externalUrl?.includes('/action/movie/'));
  assert.ok(tiles[0].isAction);
});

test('buildTiles: movie missing with searchOnAdd=false shows extra search tile', async () => {
  const config = makeConfig({
    radarr: { ...makeConfig().radarr, enabled: true, searchOnAdd: false }
  });
  const service = new ArrStatusService(config);

  const radarrClient = service.getRadarrClient();
  (radarrClient as unknown as Record<string, unknown>).getMovieStatus = async () => ({
    state: 'missing',
    monitored: true,
    hasFile: false
  });

  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 2);
  assert.equal(tiles[0].description, 'Radarr • Missing');
  assert.equal(tiles[1].description, 'Search in Radarr');
  assert.ok(tiles[1].isAction);
});

test('buildTiles: movie missing with searchOnAdd=true shows only status tile', async () => {
  const config = makeConfig({
    radarr: { ...makeConfig().radarr, enabled: true, searchOnAdd: true }
  });
  const service = new ArrStatusService(config);

  const radarrClient = service.getRadarrClient();
  (radarrClient as unknown as Record<string, unknown>).getMovieStatus = async () => ({
    state: 'missing',
    monitored: true,
    hasFile: false
  });

  const tiles = await service.buildTiles(movieId('tt0000001'));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].description, 'Radarr • Missing');
});

test('buildTiles: episode downloaded tile has name Sonarr', async () => {
  const config = makeConfig({
    sonarr: { ...makeConfig().sonarr, enabled: true }
  });
  const service = new ArrStatusService(config);

  const sonarrClient = service.getSonarrClient();
  (sonarrClient as unknown as Record<string, unknown>).getEpisodeStatus = async () => ({
    state: 'episode_downloaded',
    hasFile: true
  });

  const tiles = await service.buildTiles(seriesId('tt0000001', 1, 1));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Sonarr');
  assert.equal(tiles[0].description, 'Sonarr • Episode Downloaded');
});

test('buildTiles: series not_added tile has add action URL', async () => {
  const config = makeConfig({
    sonarr: { ...makeConfig().sonarr, enabled: true }
  });
  const service = new ArrStatusService(config);

  const sonarrClient = service.getSonarrClient();
  (sonarrClient as unknown as Record<string, unknown>).getEpisodeStatus = async () => ({
    state: 'series_not_added'
  });

  const tiles = await service.buildTiles(seriesId('tt0000001', 1, 1));
  assert.equal(tiles.length, 1);
  assert.equal(tiles[0].name, 'Sonarr');
  assert.equal(tiles[0].description, 'Add to Sonarr + Search');
  assert.ok(tiles[0].externalUrl?.includes('/action/series/'));
});

test('buildReturnLink: returns correct stremio:// deep link for movie', () => {
  const config = makeConfig();
  const service = new ArrStatusService(config);
  const link = service.buildReturnLink(movieId('tt1234567'));
  assert.equal(link, 'stremio:///detail/movie/tt1234567/tt1234567');
});
