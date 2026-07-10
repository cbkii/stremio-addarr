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

test('mergeCatalogItems securely retains original poster metadata when candidate replaces an imported or queued asset', () => {
  // Test scenario where an existing imported item HAS a poster, and a downloading candidate WITHOUT a poster supersedes it.
  const merged = mergeMovieItems([
    movieItem({ imdbId: 'tt10', status: 'imported', timestamp: 10, poster: 'https://existing.poster' }),
    movieItem({ imdbId: 'tt10', status: 'downloading', timestamp: 5 })
  ]);

  // Best match should be downloading, but its poster property should have inherited the 'https://existing.poster'
  assert.equal(merged.length, 1);
  assert.equal(merged[0].status, 'downloading');
  assert.equal(merged[0].poster, 'https://existing.poster', 'Downloading supersede missing poster must backfill using discarded entity poster');

  // Verify pure items don't mutate parameters themselves
  const originalMissingPosterItem = movieItem({ imdbId: 'tt20', status: 'downloading', timestamp: 5 });
  const merged2 = mergeMovieItems([
    movieItem({ imdbId: 'tt20', status: 'imported', timestamp: 10, poster: 'https://existing.poster' }),
    originalMissingPosterItem
  ]);

  assert.equal(merged2[0].poster, 'https://existing.poster');
  assert.equal(originalMissingPosterItem.poster, undefined, 'Input objects must remain purely immutable retaining undef properties natively');
});

test('downloading fallback release info can omit progress and eta', () => {
  assert.equal(downloadingReleaseInfo(undefined, undefined, false), 'Downloading • ETA unknown');
});

class TrackingWatchedLookup implements WatchedLookup {
  public batchCalls = 0;
  public singleCalls = 0;
  constructor(private readonly watchedIds: Set<string>, private readonly omitBatchMethod = false) {}
  async isMovieWatched(imdbId: string): Promise<boolean> {
    this.singleCalls++;
    return this.watchedIds.has(imdbId);
  }
  get areMoviesWatched() {
    if (this.omitBatchMethod) return undefined;
    return async (imdbIds: readonly string[]): Promise<Map<string, boolean>> => {
      this.batchCalls++;
      const m = new Map<string, boolean>();
      for (const id of imdbIds) m.set(id, this.watchedIds.has(id));
      return m;
    };
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

test('catalog service falls back to single lookup when batch method is absent', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;

  const fakeRadarr = {
    async listMovies() {
      return Array.from({ length: 10 }, (_, i) => ({ id: i + 1, title: `Movie ${i}`, imdbId: `tt${i}` }));
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };

  const lookup = new TrackingWatchedLookup(new Set(['tt0', 'tt1']), true);

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never,
    watchedLookup: lookup
  });

  const result = await service.buildCatalog('radarr-recent', 0, 5, 'unwatched');
  assert.equal(result.metas.length, 5);
  // Skipped tt0 and tt1 so to get 5 metas, it needs to scan exactly 7 items
  assert.equal(lookup.singleCalls, 7, 'should have fallen back exactly to single lookups per scan');
  assert.equal(lookup.batchCalls, 0, 'should not have used absent batch logic');
});

test('catalog service concurrency lock prevents overlapping pagination duplicate calls', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;

  const fakeRadarr = {
    async listMovies() {
      return Array.from({ length: 60 }, (_, i) => ({ id: i + 1, title: `Movie ${i}`, imdbId: `tt${i}` }));
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };

  const lookup = new TrackingWatchedLookup(new Set([]));

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never,
    watchedLookup: lookup
  });

  // Execute two identical requests concurrently
  const [res1, res2] = await Promise.all([
    service.buildCatalog('radarr-recent', 0, 50, 'unwatched'),
    service.buildCatalog('radarr-recent', 0, 50, 'unwatched')
  ]);

  assert.equal(res1.metas.length, 50);
  assert.equal(res2.metas.length, 50);
  assert.deepEqual(res1.metas, res2.metas, 'concurrent requests should return same array');

  // They should not have duplicated the work / scanned into 100+
  assert.equal(lookup.batchCalls, 1, 'only one request should perform the batch lookup due to the promise lock');
});

test('catalog service progress tracking ignores single lookup exceptions completely, allowing later successful retries without skipping entries internally', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;

  const fakeRadarr = {
    async listMovies() {
      return Array.from({ length: 5 }, (_, i) => ({ id: i + 1, title: `Movie ${i}`, imdbId: `tt${i}` }));
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };

  let calls = 0;
  const lookup = new TrackingWatchedLookup(new Set([]), true);
  // Stubbing manual error throwing during the 3rd iteration
  const rawMethod = lookup.isMovieWatched.bind(lookup);
  lookup.isMovieWatched = async (id: string) => {
    calls++;
    if (calls === 3) throw new Error('Simulated Transient Network Exception');
    return await rawMethod(id);
  };

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: { async listSeries() { return []; }, async listSeriesQueueDetails() { return []; }, async listRecentSeriesImports() { return []; } } as never,
    watchedLookup: lookup
  });

  try {
    await service.buildCatalog('radarr-recent', 0, 5, 'unwatched');
    assert.fail('first execution must throw');
  } catch (err) {
    // Expected exception
  }

  // The 3rd item was tt2. Because it rejected, the scannedIndex tracking shouldn't have advanced past 2 (it crashed on index 2).
  // The next retry should resume at index 2 correctly finding 'tt2' natively.
  const retryResult = await service.buildCatalog('radarr-recent', 0, 5, 'unwatched');

  // Since 2 successfully processed previously, 3 remaining (tt2, tt3, tt4).
  // It shouldn't skip `tt2`.
  assert.equal(retryResult.metas.map(m => m.id).includes('tt2'), true, 'tt2 should not have been permanently skipped by the crash');
});

test('catalog service gracefully bounds invalid or infinity limits during pagination across endpoints', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.sonarr.enabled = true;
  cfg.radarrCatalogWatchedKeepCount = 0;

  const fakeRadarr = {
    async listMovies() {
      return Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: `Movie ${i}`, imdbId: `tt${i}` }));
    },
    async listMovieQueueDetails() { return []; },
    async listRecentMovieImports() { return []; }
  };

  const fakeSonarr = {
    async listSeries() {
      return Array.from({ length: 150 }, (_, i) => ({ id: i + 1, title: `Series ${i}`, imdbId: `tt${i + 200}` }));
    },
    async listSeriesQueueDetails() { return []; },
    async listRecentSeriesImports() { return []; }
  };

  const lookup = new TrackingWatchedLookup(new Set([]));

  const service = new CatalogService(cfg, {
    radarr: fakeRadarr as never,
    sonarr: fakeSonarr as never,
    watchedLookup: lookup
  });

  const boundaries = [
    // [skip, limit, expected length, expected first ID]
    [NaN, NaN, 100, 'tt0'],
    [Infinity, Infinity, 100, 'tt0'],
    [-1, -1, 0, undefined],
    [0.5, 0.5, 0, undefined],
    [0.5, 1.5, 1, 'tt0'],
    [100, 200, 50, 'tt100'],
    [-5, 50, 50, 'tt0'],
    [5, -50, 0, undefined],
    [10, 0, 0, undefined]
  ] as const;

  for (const [skip, limit, expectedLength, expectedFirst] of boundaries) {
    const resUnwatched = await service.buildCatalog('radarr-recent', skip as never, limit as never, 'unwatched');
    assert.equal(resUnwatched.metas.length, expectedLength, `radarr unwatched length failed for skip ${skip}, limit ${limit}`);
    if (expectedLength > 0) assert.equal(resUnwatched.metas[0].id, expectedFirst, `radarr unwatched first item failed for skip ${skip}, limit ${limit}`);

    const resRecent = await service.buildCatalog('radarr-recent', skip as never, limit as never, 'recent');
    assert.equal(resRecent.metas.length, expectedLength, `radarr recent length failed for skip ${skip}, limit ${limit}`);
    if (expectedLength > 0) assert.equal(resRecent.metas[0].id, expectedFirst, `radarr recent first item failed for skip ${skip}, limit ${limit}`);

    const sonarrRecent = await service.buildCatalog('sonarr-recent', skip as never, limit as never);
    assert.equal(sonarrRecent.metas.length, expectedLength, `sonarr recent length failed for skip ${skip}, limit ${limit}`);
    if (expectedLength > 0) {
      // expectedFirst is 'tt0' for skip=0, which corresponds to index 0.
      // For Sonarr, index 0 has imdbId `tt${0 + 200}` = 'tt200'.
      // If skip=100, expectedFirst is 'tt100' (index 100).
      // For Sonarr, index 100 has imdbId `tt${100 + 200}` = 'tt300'.
      const expectedSonarrId = expectedFirst?.replace(/^tt(\d+)$/, (_, num) => `tt${parseInt(num, 10) + 200}`);
      assert.equal(sonarrRecent.metas[0].id, expectedSonarrId, `sonarr recent first item failed for skip ${skip}, limit ${limit}`);
    }
  }
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
