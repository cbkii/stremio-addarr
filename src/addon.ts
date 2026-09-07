import { addonBuilder } from 'stremio-addon-sdk';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { isWebReadyHttpsMp4 } from './lib/stream-readiness.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { buildStremioDetailDeepLink } from './lib/stremio-links.js';
import type { StatusTile } from './types.js';
import { CatalogService, type CatalogFilter } from './services/catalog.js';
import { ArrStatusService } from './services/status.js';
import { NoopWatchedLookup } from './services/watched.js';
import type { WatchedLookup } from './services/watched.js';

const DIRECT_SERIES_BINGE_GROUP = 'org.cbkii.stremio-addarr|sonarr|direct|v1';

function passiveStatusDeepLink(rawUrl: string | undefined): string | undefined {
  if (!rawUrl) return undefined;
  try {
    const parsedUrl = new URL(rawUrl);
    const match = parsedUrl.pathname.match(/\/status\/(movie|series)\/([^/]+)\.m3u8$/);
    if (!match) return undefined;
    const kind = match[1] as 'movie' | 'series';
    const rawId = decodeURIComponent(match[2]);
    return buildStremioDetailDeepLink(parseStremioId(kind, rawId));
  } catch {
    return undefined;
  }
}

function isSeriesDirectFileUrl(rawUrl: string | undefined): boolean {
  if (!rawUrl) return false;
  try {
    return /\/files\/series\/\d+$/.test(new URL(rawUrl).pathname);
  } catch {
    return false;
  }
}

/**
 * Binge continuity is safe only when the filename confidently describes one
 * logical episode. Common multi-episode names are deliberately excluded so a
 * shared Sonarr episode file is not reopened from the start as "next episode".
 */
export function isConfidentSingleEpisodeFilename(filename: string | undefined): boolean {
  if (!filename) return false;
  const value = filename.trim().split(/[?#]/, 1)[0];
  if (!value) return false;

  if (/S\d{1,2}E\d{1,3}(?:[-_. ]?E\d{1,3}|-\d{1,3})/i.test(value)) return false;
  if (/(?:^|[ ._-])\d{1,2}x\d{1,3}-\d{1,3}(?:[ ._-]|$)/i.test(value)) return false;

  const seasonEpisodeMatches = value.match(/S\d{1,2}E\d{1,3}/gi) ?? [];
  const xEpisodeMatches = value.match(/(?:^|[ ._-])\d{1,2}x\d{1,3}(?=[ ._-]|$)/gi) ?? [];
  return seasonEpisodeMatches.length + xEpisodeMatches.length === 1;
}

function streamBehaviorHints(tile: StatusTile): StatusTile['behaviorHints'] | undefined {
  const original = tile.behaviorHints;
  if (!original) return undefined;

  const hints = { ...original };
  if (tile.bingeEligible && isSeriesDirectFileUrl(tile.url) && isConfidentSingleEpisodeFilename(hints.filename)) {
    hints.bingeGroup = DIRECT_SERIES_BINGE_GROUP;
  }

  if (tile.url && hints.notWebReady && isWebReadyHttpsMp4(tile.url, hints.filename)) {
    delete hints.notWebReady;
  }

  return Object.keys(hints).length > 0 ? hints : undefined;
}

export function streamFromTile(tile: StatusTile) {
  if (!tile.url && !tile.externalUrl) {
    throw new Error(`Invalid status tile without a Stremio stream source: ${tile.name}`);
  }

  // Passive status entries historically pointed at a zero-duration HLS stream
  // only to satisfy Stream Object source requirements. Keep them selectable but
  // return to the current detail page instead of entering Stremio's player and
  // local streaming-server lifecycle for non-media UI state.
  const statusDeepLink = passiveStatusDeepLink(tile.url);
  if (statusDeepLink) {
    return {
      name: tile.name,
      ...(tile.description ? { description: tile.description } : {}),
      externalUrl: statusDeepLink
    };
  }

  const behaviorHints = streamBehaviorHints(tile);
  return {
    name: tile.name,
    ...(tile.description ? { description: tile.description } : {}),
    ...(tile.url ? { url: tile.url } : {}),
    ...(tile.externalUrl ? { externalUrl: tile.externalUrl } : {}),
    ...(behaviorHints ? { behaviorHints } : {})
  };
}

export function createAddonInterface(config: AppConfig, logger?: Logger, deps?: { watchedLookup?: WatchedLookup }) {
  const catalogHardMax = 100;
  const catalogPageSize = Math.max(1, Math.min(config.catalogPageSize, catalogHardMax));
  const catalogSkipOptions = Array.from({ length: 101 }, (_, page) => String(page * catalogPageSize));
  const builder = new addonBuilder({
    id: 'org.cbkii.stremio-addarr',
    version: config.version,
    name: 'Arr Status & Add',
    description: 'Shows Radarr/Sonarr status and adds the current movie or series from Stremio.',
    catalogs: [
      {
        id: 'radarr-recent',
        type: 'movie',
        name: 'Recent on Radarr',
        extra: [
          { name: 'filter', options: ['unwatched', 'recent'], isRequired: false },
          { name: 'skip', options: catalogSkipOptions, isRequired: false }
        ]
      },
      { id: 'sonarr-recent', type: 'series', name: 'Recent on Sonarr', extra: [{ name: 'skip', options: catalogSkipOptions, isRequired: false }] }
    ],
    resources: ['stream', 'catalog'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    behaviorHints: {
      // Stremio derives Configure from the installed manifest transport path.
      // Existing environment-configured installs remain valid, so configuration
      // is offered but is not required before installation.
      configurable: config.configUiEnabled,
      configurationRequired: false
    },
    ...(config.manifestLogoUrl ? { logo: config.manifestLogoUrl } : {})
  });

  const watchedLookup = deps?.watchedLookup ?? new NoopWatchedLookup();
  const statusService = new ArrStatusService(config, { watchedLookup });
  const catalogService = new CatalogService(config, { watchedLookup });

  builder.defineStreamHandler(async ({ type, id }: { type: string; id: string }) => {
    if (type !== 'movie' && type !== 'series') {
      return { streams: [] };
    }

    const start = Date.now();
    logger?.debug('stream handler start', { type, id });

    const parsed = parseStremioId(type, id);
    const tiles = await statusService.buildTiles(parsed);

    logger?.info('stream handler complete', { type, id, tileCount: tiles.length, durationMs: Date.now() - start });

    return {
      streams: tiles.map(streamFromTile),
      cacheMaxAge: config.streamCacheMaxAgeSec,
      staleRevalidate: config.streamStaleRevalidateSec
    };
  });

  builder.defineCatalogHandler(async ({ id, type, extra }: { id: string; type: string; extra?: Record<string, string | undefined> }) => {
    const expectedType = id === 'radarr-recent' ? 'movie' : id === 'sonarr-recent' ? 'series' : null;
    const rawSkip = Number(extra?.skip ?? 0);
    const skip = Number.isFinite(rawSkip) && rawSkip > 0 ? Math.floor(rawSkip) : 0;
    const limit = Math.min(catalogHardMax, catalogPageSize);
    if (!expectedType || type !== expectedType) {
      return {
        metas: [],
        cacheMaxAge: config.catalogCacheMaxAgeSec,
        staleRevalidate: config.catalogStaleRevalidateSec,
        staleError: config.catalogStaleErrorSec
      };
    }
    const rawFilter = extra?.filter;
    let filter: CatalogFilter | undefined;
    if (rawFilter === 'recent' || rawFilter === 'unwatched') {
      filter = rawFilter;
    }
    const result = await catalogService.buildCatalog(id, skip, limit, filter);
    return {
      metas: result.metas,
      cacheMaxAge: config.catalogCacheMaxAgeSec,
      staleRevalidate: config.catalogStaleRevalidateSec,
      staleError: config.catalogStaleErrorSec
    };
  });

  return {
    addonInterface: builder.getInterface(),
    statusService
  };
}
