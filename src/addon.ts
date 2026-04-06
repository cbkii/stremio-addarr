import { addonBuilder } from 'stremio-addon-sdk';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import { parseStremioId } from './lib/stremio-ids.js';
import type { StatusTile } from './types.js';
import { ArrStatusService } from './services/status.js';

function streamFromTile(tile: StatusTile) {
  return {
    name: tile.name,
    description: tile.description,
    url: tile.url,
    externalUris: tile.externalUris,
    behaviorHints: tile.behaviorHints
  };
}

export function createAddonInterface(config: AppConfig, logger?: Logger) {
  const builder = new addonBuilder({
    id: 'org.cbkii.stremio-addarr',
    version: config.version,
    name: 'Arr Status & Add',
    description: 'Shows Radarr/Sonarr status and adds the current movie or series from Stremio.',
    catalogs: [],
    resources: ['stream'],
    types: ['movie', 'series'],
    idPrefixes: ['tt'],
    behaviorHints: {
      configurable: false,
      configurationRequired: false
    }
  });

  const statusService = new ArrStatusService(config);

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

  return {
    addonInterface: builder.getInterface(),
    statusService
  };
}
