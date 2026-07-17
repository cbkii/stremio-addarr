import { addonBuilder } from 'stremio-addon-sdk';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { parseStremioId } from './lib/stremio-ids.js';
import type { StatusTile } from './types.js';
import { CatalogService, type CatalogFilter } from './services/catalog.js';
import { ArrStatusService } from './services/status.js';
import { addSeriesMonitorScopeToActionTiles } from './services/series-monitor-scope.js';
import { NoopWatchedLookup } from './services/watched.js';
import type { WatchedLookup } from './services/watched.js';

export function streamFromTile(tile: StatusTile) {
  if (!tile.url && !tile.externalUrl) {
    throw new Error(`Invalid status tile without a Stremio stream source: ${tile.name}`);
  }
  return {
    name: tile.name,
    ...(tile.description ? { description: tile.description } : {}),
    ...(tile.url ? { url: tile.url } : {}),
    ...(tile.externalUrl ? { externalUrl: tile.externalUrl } : {}),
    ...(tile.behaviorHints ? { behaviorHints: tile.behaviorHints } : {})
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
    const displayTiles = parsed.kind === 'series'
      ? addSeriesMonitorScopeToActionTiles(tiles, config.sonarr)
      : tiles;

    logger?.info('stream handler complete', { type, id, tileCount: displayTiles.length, durationMs: Date.now() - start });

    return {
      streams: displayTiles.map(streamFromTile),
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
