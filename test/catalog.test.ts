import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService, downloadingReleaseInfo, mergeMovieItems, mergeSeriesItems } from '../src/services/catalog.js';
import type { CatalogItem } from '../src/types.js';
import { baseConfig } from './_helpers.js';

function movieItem(partial: Partial<CatalogItem>): CatalogItem {
  return {
    source: 'radarr',
    status: 'imported',
    type: 'movie',
    imdbId: 'tt1',
    title: 'Movie',
    poster: 'https://x/poster.jpg',
    posterShape: 'poster',
    releaseInfo: 'Imported today',
    timestamp: 1,
    ...partial
  };
}

test('downloading movie beats imported movie for same imdb id', () => {
  const merged = mergeMovieItems([
    movieItem({ imdbId: 'tt10', status: 'imported', timestamp: 10 }),
    movieItem({ imdbId: 'tt10', status: 'downloading', releaseInfo: 'Downloading • ETA unknown', progressPct: 5, timestamp: 5 })
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'downloading');
});

test('imported movie items sort newest first', () => {
  const merged = mergeMovieItems([
    movieItem({ imdbId: 'tt11', timestamp: 100 }),
    movieItem({ imdbId: 'tt12', timestamp: 300 }),
    movieItem({ imdbId: 'tt13', timestamp: 200 })
  ]);
  assert.deepEqual(merged.map((item) => item.imdbId), ['tt12', 'tt13', 'tt11']);
});

test('series items collapse multiple episode events to one card per series', () => {
  const merged = mergeSeriesItems([
    movieItem({ source: 'sonarr', type: 'series', imdbId: 'tt20', seasonNumber: 1, episodeNumber: 2, timestamp: 100 }),
    movieItem({ source: 'sonarr', type: 'series', imdbId: 'tt20', seasonNumber: 1, episodeNumber: 4, timestamp: 200 })
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].episodeNumber, 4);
});

test('stalled downloading release info string is preserved', () => {
  assert.equal(downloadingReleaseInfo(50, 1200, true), 'Downloading • Stalled');
});

test('downloading fallback release info can omit progress and eta', () => {
  assert.equal(downloadingReleaseInfo(undefined, undefined, false), 'Downloading • ETA unknown');
});

test('catalog service uses injectable clock for deterministic imported relative text', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.catalogCacheTtlMs = 10_000;

  const fakeRadarr = {
    async listMovies() {
      return [{ id: 1, title: 'Movie A', imdbId: 'tt100', images: [{ coverType: 'poster', remoteUrl: 'https://img/p.jpg' }] }];
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() {
      return [{ movieId: 1, date: '1970-01-02T00:00:00Z' }];
    },
    resolvePosterUrl() { return 'https://img/p.jpg'; }
  };

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; }, resolvePosterUrl() { return undefined; } } as never,
    clock: { now: () => Date.parse('1970-01-04T00:00:00Z') }
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas[0]?.releaseInfo, 'Imported 2d ago');
});

test('catalog service can enrich posters from TMDB when Arr posters are missing', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.tmdbApiKey = 'tmdb-test-key';
  cfg.catalogCacheTtlMs = 10_000;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response('{"movie_results":[{"poster_path":"/abc.jpg"}]}', { status: 200 })) as typeof fetch;

  const fakeRadarr = {
    async listMovies() {
      return [{ id: 1, title: 'Movie B', imdbId: 'tt101' }];
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() {
      return [{ movieId: 1, date: '1970-01-02T00:00:00Z' }];
    },
    resolvePosterUrl() { return undefined; }
  };

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; }, resolvePosterUrl() { return undefined; } } as never
  });

  try {
    const result = await service.buildCatalog('radarr-recent', 0, 25);
    assert.equal(result.metas[0]?.poster, 'https://image.tmdb.org/t/p/w500/abc.jpg');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('catalog merge output uses short ttl cache', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.catalogCacheTtlMs = 10_000;
  let moviesCalls = 0;

  const fakeRadarr = {
    async listMovies() {
      moviesCalls++;
      return [{ id: 1, title: 'Movie C', imdbId: 'tt102', images: [{ coverType: 'poster', remoteUrl: 'https://img/p2.jpg' }] }];
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() {
      return [{ movieId: 1, date: '1970-01-02T00:00:00Z' }];
    },
    resolvePosterUrl() { return 'https://img/p2.jpg'; }
  };

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; }, resolvePosterUrl() { return undefined; } } as never
  });

  await service.buildCatalog('radarr-recent', 0, 25);
  await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(moviesCalls, 1);
});
