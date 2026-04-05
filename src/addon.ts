import { addonBuilder } from 'stremio-addon-sdk';
import type { AppConfig } from './config.js';
import { parseStremioId } from './lib/stremio-ids.js';
import type { StatusTile } from './types.js';
import { ArrStatusService } from './services/status.js';

function streamFromTile(tile: StatusTile) {
  return {
    name: tile.name,
    description: tile.description,
    externalUrl: tile.externalUrl
  };
}

export function createAddonInterface(config: AppConfig) {
  const builder = new addonBuilder({
    id: 'org.cbkii.stremio-addarr',
    version: '0.1.0',
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

    const parsed = parseStremioId(type, id);
    const tiles = await statusService.buildTiles(parsed);
    return { streams: tiles.map(streamFromTile) };
  });

  return {
    addonInterface: builder.getInterface(),
    statusService
  };
}
