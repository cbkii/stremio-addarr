import test from 'node:test';
import assert from 'node:assert/strict';
import { CatalogService, downloadingReleaseInfo, mergeMovieItems, mergeSeriesItems } from '../src/services/catalog.js';
import type { CatalogItem } from '../src/types.js';
import type { WatchedLookup } from '../src/services/watched.js';
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

test('imported items use added timestamp as tiebreaker when download timestamps are missing', () => {
  const merged = mergeMovieItems([
    movieItem({ imdbId: 'tt11', timestamp: 0, addedTimestamp: 100 }),
    movieItem({ imdbId: 'tt12', timestamp: 0, addedTimestamp: 300 }),
    movieItem({ imdbId: 'tt13', timestamp: 0, addedTimestamp: 200 })
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

class TrackingWatchedLookup implements WatchedLookup {
  public batchCalls = 0;
  public singleCalls = 0;
  constructor(private readonly watchedIds: Set<string>) {}
  async isMovieWatched(imdbId: string): Promise<boolean> {
    this.singleCalls++;
    return this.watchedIds.has(imdbId);
  }
  async areMoviesWatched(imdbIds: readonly string[]): Promise<Map<string, boolean>> {
    this.batchCalls++;
    const m = new Map<string, boolean>();
    for (const id of imdbIds) m.set(id, this.watchedIds.has(id));
    return m;
  }
  async isEpisodeWatched(): Promise<boolean> { return false; }
}

test('catalog service uses batch lookup for pagination filtering', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;

  const fakeRadarr = {
    async listMovies() {
      // Return 60 movies so that at least two batches of 50 are needed to find enough un-watched
      return Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `Movie ${i}`, imdbId: `tt${i}` }));
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };

  const lookup = new TrackingWatchedLookup(new Set(['tt0', 'tt1', 'tt2'])); // first three watched

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never,
    watchedLookup: lookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 50, 'unwatched');
  assert.equal(result.metas.length, 50);
  assert.ok(lookup.batchCalls >= 1, 'should have used batch lookup');
  assert.equal(lookup.singleCalls, 0, 'should not have fallen back to single lookup');
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

test('catalog output includes metahub poster URL for card rendering', async () => {
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
  assert.equal(result.metas[0]?.poster, 'https://images.metahub.space/poster/medium/tt304/img');
});

test('catalog prefers Arr remote poster when available and falls back to metahub otherwise', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() {
        return [
          { id: 7, title: 'Arr Poster Movie', imdbId: 'tt307', images: [{ coverType: 'poster', remoteUrl: 'https://image.tmdb.org/t/p/w342/abc.jpg' }] },
          { id: 8, title: 'No Arr Poster Movie', imdbId: 'tt308', images: [{ coverType: 'poster', url: '/MediaCover/8/poster.jpg' }] }
        ];
      },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() {
        return [
          { movieId: 7, date: '1970-01-02T00:00:00Z' },
          { movieId: 8, date: '1970-01-02T00:00:00Z' }
        ];
      }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  const byId = new Map(result.metas.map((meta) => [meta.id, meta]));
  assert.equal(byId.get('tt307')?.poster, 'https://image.tmdb.org/t/p/w342/abc.jpg');
  assert.equal(byId.get('tt308')?.poster, 'https://images.metahub.space/poster/medium/tt308/img');
});

test('catalog normalizes uppercase imdb ids for native Stremio metadata lookup', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return [{ id: 5, title: 'Uppercase IMDb', imdbId: 'TT305' }]; },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() { return [{ movieId: 5, date: '1970-01-02T00:00:00Z' }]; }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas[0]?.id, 'tt305');
});

test('catalog drops invalid non-imdb ids to avoid broken native poster lookups', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: { async listMovies() { return []; }, async listMovieQueueDetails() { return []; }, async listRecentMovieImports() { return []; } } as never,
    sonarr: {
      async listSeries() { return [{ id: 6, title: 'Bad Id', imdbId: '12345' }]; },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() { return [{ seriesId: 6, date: '1970-01-02T00:00:00Z' }]; }
    } as never
  });

  const result = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.equal(result.metas.length, 0);
});

test('radarr catalog fills to limit from library even when history is sparse', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const movies = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    title: `Movie ${i + 1}`,
    imdbId: `tt${1000 + i}`,
    added: `2024-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`
  }));

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return movies; },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() { return [{ movieId: 1, date: '2024-03-01T00:00:00Z' }]; }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.equal(result.metas.length, 25);
});

test('sonarr catalog fills to limit from library even when history is sparse', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const series = Array.from({ length: 30 }, (_, i) => ({
    id: i + 1,
    title: `Series ${i + 1}`,
    imdbId: `tt${2000 + i}`,
    added: `2024-02-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`
  }));

  const service = new CatalogService(cfg, {
    radarr: { async listMovies() { return []; }, async listMovieQueueDetails() { return []; }, async listRecentMovieImports() { return []; } } as never,
    sonarr: {
      async listSeries() { return series; },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() { return [{ seriesId: 1, date: '2024-03-01T00:00:00Z' }]; }
    } as never
  });

  const result = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.equal(result.metas.length, 25);
});

test('radarr catalog sorts by latest import first, then by most recent added date', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() {
        return [
          { id: 1, title: 'Imported Newest', imdbId: 'tt4001', added: '2024-01-01T00:00:00Z' },
          { id: 2, title: 'Imported Older', imdbId: 'tt4002', added: '2024-03-01T00:00:00Z' },
          { id: 3, title: 'Added Newest', imdbId: 'tt4003', added: '2024-04-01T00:00:00Z' },
          { id: 4, title: 'Added Older', imdbId: 'tt4004', added: '2024-02-01T00:00:00Z' }
        ];
      },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() {
        return [
          { movieId: 2, date: '2024-02-10T00:00:00Z' },
          { movieId: 1, date: '2024-03-15T00:00:00Z' }
        ];
      }
    } as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.deepEqual(result.metas.map((m) => m.id), ['tt4001', 'tt4002', 'tt4003', 'tt4004']);
});

test('sonarr catalog sorts by latest import first, then by most recent added date', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: { async listMovies() { return []; }, async listMovieQueueDetails() { return []; }, async listRecentMovieImports() { return []; } } as never,
    sonarr: {
      async listSeries() {
        return [
          { id: 11, title: 'Imported Newest', imdbId: 'tt5001', added: '2024-01-01T00:00:00Z' },
          { id: 12, title: 'Imported Older', imdbId: 'tt5002', added: '2024-03-01T00:00:00Z' },
          { id: 13, title: 'Added Newest', imdbId: 'tt5003', added: '2024-04-01T00:00:00Z' },
          { id: 14, title: 'Added Older', imdbId: 'tt5004', added: '2024-02-01T00:00:00Z' }
        ];
      },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() {
        return [
          { seriesId: 12, date: '2024-02-10T00:00:00Z' },
          { seriesId: 11, date: '2024-03-15T00:00:00Z' }
        ];
      }
    } as never
  });

  const result = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.deepEqual(result.metas.map((m) => m.id), ['tt5001', 'tt5002', 'tt5003', 'tt5004']);
});

test('catalog still returns library items when history endpoints fail', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.sonarr.enabled = true;

  const service = new CatalogService(cfg, {
    radarr: {
      async listMovies() { return [{ id: 20, title: 'Movie Fallback', imdbId: 'tt6001', added: '2024-05-01T00:00:00Z' }]; },
      async listMovieQueueDetails() { return []; },
      async listRecentMovieImports() { throw new Error('history failed'); }
    } as never,
    sonarr: {
      async listSeries() { return [{ id: 21, title: 'Series Fallback', imdbId: 'tt6002', added: '2024-05-01T00:00:00Z' }]; },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() { throw new Error('history failed'); }
    } as never
  });

  const radarr = await service.buildCatalog('radarr-recent', 0, 25);
  const sonarr = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.equal(radarr.metas[0]?.id, 'tt6001');
  assert.equal(sonarr.metas[0]?.id, 'tt6002');
});

// --- Watched-filter tests (movie items only) ---

function makeWatchedLookup(watchedImdbIds: Set<string>): WatchedLookup {
  return {
    async isMovieWatched(imdbId) { return watchedImdbIds.has(imdbId); },
    async isEpisodeWatched() { return false; }
  };
}

function makeRadarrDeps(movies: Array<{ id: number; title: string; imdbId: string; added?: string }>) {
  return {
    async listMovies() { return movies; },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };
}

const sonarrNoop = {
  async listSeries() { return []; },
  async listSeriesQueueDetails() { return []; },
  async listRecentSeriesImports() { return []; }
};

test('radarr catalog with no filter keeps one recent watched movie by default', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const movies = [
    { id: 1, title: 'Newest Watched Movie', imdbId: 'tt7001', added: '2024-03-03T00:00:00Z' },
    { id: 2, title: 'Unwatched Movie', imdbId: 'tt7002', added: '2024-03-02T00:00:00Z' },
    { id: 3, title: 'Older Watched Movie', imdbId: 'tt7003', added: '2024-03-01T00:00:00Z' }
  ];
  const watchedLookup = makeWatchedLookup(new Set(['tt7001', 'tt7003']));

  const service = new CatalogService(cfg, {
    radarr: makeRadarrDeps(movies) as never,
    sonarr: sonarrNoop as never,
    watchedLookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  const ids = result.metas.map((m) => m.id);
  assert.ok(ids.includes('tt7001'), 'newest watched movie must be kept');
  assert.ok(ids.includes('tt7002'), 'unwatched movie must be included');
  assert.ok(!ids.includes('tt7003'), 'older watched movies beyond keep count must be excluded');
});

test('radarr catalog filter=unwatched keeps one recent watched movie by default', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const movies = [
    { id: 1, title: 'Newest Watched Movie', imdbId: 'tt7001', added: '2024-03-03T00:00:00Z' },
    { id: 2, title: 'Unwatched Movie', imdbId: 'tt7002', added: '2024-03-02T00:00:00Z' },
    { id: 3, title: 'Older Watched Movie', imdbId: 'tt7003', added: '2024-03-01T00:00:00Z' }
  ];
  const watchedLookup = makeWatchedLookup(new Set(['tt7001', 'tt7003']));

  const service = new CatalogService(cfg, {
    radarr: makeRadarrDeps(movies) as never,
    sonarr: sonarrNoop as never,
    watchedLookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25, 'unwatched');
  const ids = result.metas.map((m) => m.id);
  assert.ok(ids.includes('tt7001'), 'newest watched movie must be kept');
  assert.ok(ids.includes('tt7002'), 'unwatched movie must be included');
  assert.ok(!ids.includes('tt7003'), 'older watched movies beyond keep count must be excluded');
});

test('radarr catalog watched keep count is configurable', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 2;

  const movies = [
    { id: 1, title: 'Newest Watched Movie', imdbId: 'tt7001', added: '2024-03-03T00:00:00Z' },
    { id: 2, title: 'Unwatched Movie', imdbId: 'tt7002', added: '2024-03-02T00:00:00Z' },
    { id: 3, title: 'Older Watched Movie', imdbId: 'tt7003', added: '2024-03-01T00:00:00Z' }
  ];
  const watchedLookup = makeWatchedLookup(new Set(['tt7001', 'tt7003']));

  const service = new CatalogService(cfg, {
    radarr: makeRadarrDeps(movies) as never,
    sonarr: sonarrNoop as never,
    watchedLookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25);
  assert.deepEqual(result.metas.map((m) => m.id), ['tt7001', 'tt7002', 'tt7003']);
});

test('radarr catalog filter=recent includes all movies regardless of watched status', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  const movies = [
    { id: 1, title: 'Watched Movie', imdbId: 'tt7001' },
    { id: 2, title: 'Unwatched Movie', imdbId: 'tt7002' }
  ];
  const watchedLookup = makeWatchedLookup(new Set(['tt7001']));

  const service = new CatalogService(cfg, {
    radarr: makeRadarrDeps(movies) as never,
    sonarr: sonarrNoop as never,
    watchedLookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 25, 'recent');
  const ids = result.metas.map((m) => m.id);
  assert.ok(ids.includes('tt7001'), 'watched movie must be included in recent');
  assert.ok(ids.includes('tt7002'), 'unwatched movie must be included in recent');
});

test('sonarr catalog is not affected by watched filter', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  const watchedLookup = makeWatchedLookup(new Set(['tt8001']));

  const service = new CatalogService(cfg, {
    radarr: { async listMovies() { return []; }, async listMovieQueueDetails() { return []; }, async listRecentMovieImports() { return []; } } as never,
    sonarr: {
      async listSeries() { return [{ id: 1, title: 'Watched Show', imdbId: 'tt8001' }]; },
      async listSeriesQueueDetails() { return []; },
      async listRecentSeriesImports() { return [{ seriesId: 1, date: '2024-01-01T00:00:00Z' }]; }
    } as never,
    watchedLookup
  });

  // sonarr-recent with no filter should still return the series (watched filter not applied)
  const result = await service.buildCatalog('sonarr-recent', 0, 25);
  assert.equal(result.metas.length, 1);
  assert.equal(result.metas[0]?.id, 'tt8001');
});

test('radarr filtered pagination caches progressive watched checks and avoids rescanning', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 1;
  const calls: string[] = [];
  const watchedLookup: WatchedLookup = {
    async isMovieWatched(imdbId) { calls.push(imdbId); return imdbId === 'tt9001' || imdbId === 'tt9003'; },
    async isEpisodeWatched() { return false; }
  };
  const movies = [1, 2, 3, 4, 5].map((n) => ({ id: n, title: `M${n}`, imdbId: `tt900${n}`, added: `2024-03-0${n}T00:00:00Z` }));
  const service = new CatalogService(cfg, { radarr: makeRadarrDeps(movies) as never, sonarr: sonarrNoop as never, watchedLookup });

  const page1 = await service.buildCatalog('radarr-recent', 0, 2);
  assert.deepEqual(page1.metas.map((m) => m.id), ['tt9005', 'tt9004']);
  assert.equal(calls.length, 2);

  const page2 = await service.buildCatalog('radarr-recent', 2, 2);
  assert.deepEqual(page2.metas.map((m) => m.id), ['tt9003', 'tt9002']);
  assert.equal(calls.length, 4);

  await service.buildCatalog('radarr-recent', 2, 2);
  assert.equal(calls.length, 4);
});

test('radarr watched keep count is global across pages and can be zero', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;
  const watchedLookup = makeWatchedLookup(new Set(['tt9105', 'tt9104', 'tt9103']));
  const movies = [1, 2, 3, 4, 5].map((n) => ({ id: n, title: `M${n}`, imdbId: `tt910${n}`, added: `2024-03-0${n}T00:00:00Z` }));
  const service = new CatalogService(cfg, { radarr: makeRadarrDeps(movies) as never, sonarr: sonarrNoop as never, watchedLookup });

  const page = await service.buildCatalog('radarr-recent', 0, 3);
  assert.deepEqual(page.metas.map((m) => m.id), ['tt9102', 'tt9101']);
});
