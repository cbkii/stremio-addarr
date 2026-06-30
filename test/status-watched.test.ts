import test from 'node:test';
import assert from 'node:assert/strict';
import { ArrStatusService } from '../src/services/status.js';
import type { WatchedLookup } from '../src/services/watched.js';
import type { TmdbLookup } from '../src/services/tmdb.js';
import type { TraktLookup } from '../src/services/trakt.js';
import { parseStremioId } from '../src/lib/stremio-ids.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

class StaticWatchedLookup implements WatchedLookup {
  constructor(
    private readonly movieWatched: boolean,
    private readonly episodeWatched: boolean
  ) {}

  async isMovieWatched(_imdbId: string): Promise<boolean> {
    return this.movieWatched;
  }

  async isEpisodeWatched(_imdbId: string, _season?: number, _episode?: number): Promise<boolean> {
    return this.episodeWatched;
  }
}

class FailingTraktWatchedLookup extends StaticWatchedLookup {
  getDiagnostics() {
    return { enabled: true, provider: 'trakt' as const, lastSyncError: 'http_500' };
  }
}

class StaticTraktLookup implements TraktLookup {
  constructor(
    private readonly movieDate?: string,
    private readonly episodeDate?: string
  ) {}

  async getMovieReleaseDate(_imdbId: string): Promise<string | undefined> {
    return this.movieDate;
  }

  async getEpisodeReleaseDate(_imdbId: string, _season?: number, _episode?: number): Promise<string | undefined> {
    return this.episodeDate;
  }

  async getMovieTmdbId(_imdbId: string): Promise<number | undefined> {
    return undefined;
  }
}

class StaticTmdbLookup implements TmdbLookup {
  constructor(
    private readonly movieDate?: string,
    private readonly episodeDate?: string
  ) {}

  async getMovieReleaseDate(_imdbId: string): Promise<string | undefined> {
    return this.movieDate;
  }

  async getEpisodeReleaseDate(_imdbId: string, _season?: number, _episode?: number): Promise<string | undefined> {
    return this.episodeDate;
  }

  async getMovieTmdbId(_imdbId: string): Promise<number | undefined> {
    return undefined;
  }
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('movie downloaded description mentions WATCHED and stays within 5 lines', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"Mock Movie","digitalRelease":"2020-02-03T00:00:00Z","hasFile":true,"monitored":true}]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(true, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt1234567'));
  const lines = (tiles[0]?.description ?? '').split('\n');
  assert.ok(lines.some(l => l.includes('WATCHED')), 'description should mention WATCHED');
  assert.ok(lines.length <= 5);
});

test('movie missing description mentions UNWATCHED and includes a search action', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"Mock Movie","physicalRelease":"2020-03-07","hasFile":false,"monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt1234567'));
  const lines = (tiles[0]?.description ?? '').split('\n');
  assert.ok(lines.some(l => l.includes('UNWATCHED')), 'description should mention UNWATCHED');
  assert.ok(lines.some(l => l.includes('SEARCH')), 'description should include a search action prompt');
  assert.ok(lines.length <= 5);
});

test('episode downloaded description mentions WATCHED and stays within 5 lines', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"airDateUtc":"2024-01-09T00:00:00Z","monitored":true,"hasFile":true}]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, true),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt7654321:2:5'));
  const lines = (tiles[0]?.description ?? '').split('\n');
  assert.ok(lines.some(l => l.includes('WATCHED')), 'description should mention WATCHED');
  assert.ok(lines.length <= 5);
});

test('episode missing description mentions UNWATCHED and includes a search action', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"airDateUtc":"2024-01-09T00:00:00Z","monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt7654321:2:5'));
  const lines = (tiles[0]?.description ?? '').split('\n');
  assert.ok(lines.some(l => l.includes('UNWATCHED')), 'description should mention UNWATCHED');
  assert.ok(lines.some(l => l.includes('SEARCH')), 'description should include a search action prompt');
  assert.ok(lines.length <= 5);
});

test('shows ?📅 when neither Arr nor Trakt has a valid movie date', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"No Date Movie","hasFile":false,"monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt1234567'));
  assert.ok((tiles[0]?.description ?? '').includes('?📅'), 'description should include date placeholder');
});

test('uses Trakt as final fallback when Arr episode date is missing', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, '2024-01-09')
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt7654321:2:5'));
  assert.ok((tiles[0]?.description ?? '').includes('S02E05 (09 Jan 24)'));
});

test('uses TMDB fallback when Arr and Trakt do not provide an episode date', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    if (path.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined),
    tmdbLookup: new StaticTmdbLookup(undefined, '2024-01-10')
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt7654321:2:5'));
  assert.ok((tiles[0]?.description ?? '').includes('S02E05 (10 Jan 24)'));
});

test('falls back to legacy border line when Trakt is failing', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"Movie","physicalRelease":"2020-03-07","hasFile":false,"monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new FailingTraktWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt1234567'));
  const firstLine = (tiles[0]?.description ?? '').split('\n')[0];
  assert.equal(firstLine, '════════════════════');
});

test('not_added movie shows Trakt release date in description', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup('2021-03-15', undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt9999999'));
  const desc = tiles[0]?.description ?? '';
  assert.ok(desc.includes('Not in Radarr'));
  assert.ok(desc.includes('(15 Mar 21)'));
});

test('not_added movie shows 📽 Not in Radarr without date when Trakt returns nothing', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt9999999'));
  const desc = tiles[0]?.description ?? '';
  // Shows plain "Not in Radarr" — no ?📅 noise for not-yet-added items.
  assert.ok(desc.includes('Not in Radarr'));
  assert.ok(!desc.includes('(?📅)'));
});

test('uses TMDB movie date fallback when Arr and Trakt dates are unavailable', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup('1900-01-01', undefined),
    tmdbLookup: new StaticTmdbLookup('2024-06-01', undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt9999999'));
  assert.ok((tiles[0]?.description ?? '').includes('(01 Jun 24)'));
});

test('series_not_added shows episode+date from Trakt in description', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[]', { status: 200 });
    if (path.startsWith('/api/v3/series/lookup')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, '2024-03-22')
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt8888888:3:7'));
  const desc = tiles[0]?.description ?? '';
  assert.ok(desc.includes('Not in Sonarr'));
  assert.ok(desc.includes('S03E07 (22 Mar 24)'));
  assert.ok(desc.split('\n').length <= 5);
});

test('series_not_added shows episode identifier even when no date available', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/series') return new Response('[]', { status: 200 });
    if (path.startsWith('/api/v3/series/lookup')) return new Response('[]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('series', 'tt8888888:3:7'));
  const desc = tiles[0]?.description ?? '';
  assert.ok(desc.includes('Not in Sonarr'));
  // Episode identifier always shown even without a date.
  assert.ok(desc.includes('S03E07'));
  assert.ok(desc.split('\n').length <= 5);
});

test('formats datetime release in configured TZ when possible', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.timeZone = 'America/Los_Angeles';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      return new Response('[{"id":9,"imdbId":"tt1234567","title":"TZ Movie","digitalRelease":"2020-01-01T01:00:00Z","hasFile":true,"monitored":true}]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const service = new ArrStatusService(cfg, {
    watchedLookup: new StaticWatchedLookup(false, false),
    traktLookup: new StaticTraktLookup(undefined, undefined)
  });
  const tiles = await service.buildTiles(parseStremioId('movie', 'tt1234567'));
  assert.ok((tiles[0]?.description ?? '').includes('(31 Dec 19)'));
});
