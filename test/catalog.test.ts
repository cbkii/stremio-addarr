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

test('better downloading movie row wins when same imdb has multiple queue rows', () => {
  const merged = mergeMovieItems([
    movieItem({ imdbId: 'tt30', status: 'downloading', stalled: true, progressPct: 95, etaSeconds: 120, timestamp: 1 }),
    movieItem({ imdbId: 'tt30', status: 'downloading', stalled: false, progressPct: 20, etaSeconds: 600, timestamp: 1 })
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].stalled, false);
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
      return [{ id: 1, title: 'Movie A', imdbId: 'tt100' }];
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() {
      return [{ movieId: 1, date: '1970-01-02T00:00:00Z' }];
    }
  };

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never,
    clock: { now: () => Date.parse('1970-01-04T00:00:00Z') }
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas[0]?.releaseInfo, 'Imported 2d ago');
});

test('catalog service includes queue-only items (no import history)', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return [{ id: 1, title: 'Movie Q', imdbId: 'tt301' }]; },
      async listMovieQueueDetails() { return [{ movieId: 1, trackedDownloadStatus: 'downloading', size: 100, sizeleft: 50 }]; },
      async listRecentMovieImports() { return []; }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas.length, 1);
  assert.equal(result.metas[0]?.id, 'tt301');
});

test('catalog service includes import-only items (no queue)', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: { async listMovies() { return []; }, async listMovieQueueDetails() { return []; }, async listRecentMovieImports() { return []; } } as never,
    sonarr: {
      async listSeries() { return [{ id: 2, title: 'Series I', imdbId: 'tt302' }]; },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() { return [{ seriesId: 2, date: '1970-01-02T00:00:00Z' }]; }
    } as never
  });

  const result = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.equal(result.metas.length, 1);
  assert.equal(result.metas[0]?.id, 'tt302');
});

test('catalog merge deduplicates queue/import by imdb id', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return [{ id: 3, title: 'Movie M', imdbId: 'tt303' }]; },
      async listMovieQueueDetails() { return [{ movieId: 3, trackedDownloadStatus: 'downloading', size: 100, sizeleft: 10 }]; },
      async listRecentMovieImports() { return [{ movieId: 3, date: '1970-01-02T00:00:00Z' }]; }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas.length, 1);
  assert.match(result.metas[0]?.releaseInfo ?? '', /Downloading/);
});

test('catalog output does not depend on poster availability', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return [{ id: 4, title: 'No Poster Movie', imdbId: 'tt304' }]; },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() { return [{ movieId: 4, date: '1970-01-02T00:00:00Z' }]; }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas.length, 1);
  assert.equal('poster' in result.metas[0], false);
});

