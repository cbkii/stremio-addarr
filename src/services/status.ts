import type { AppConfig } from '../config.js';
import { toStremioDetailLink } from '../lib/stremio-ids.js';
import type { AddActionResult, ParsedStremioId, StatusTile } from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';

export class ArrStatusService {
  private readonly radarr: RadarrClient;
  private readonly sonarr: SonarrClient;

  constructor(private readonly config: AppConfig) {
    this.radarr = new RadarrClient(config);
    this.sonarr = new SonarrClient(config);
  }

  getRadarrClient(): RadarrClient {
    return this.radarr;
  }

  getSonarrClient(): SonarrClient {
    return this.sonarr;
  }

  async buildTiles(parsed: ParsedStremioId): Promise<StatusTile[]> {
    if (parsed.kind === 'movie') {
      if (!this.config.radarr.enabled) return [];
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      const tiles: StatusTile[] = [];
      switch (status.state) {
        case 'downloaded':
          tiles.push({ name: 'Radarr', description: 'Radarr • Downloaded' });
          break;
        case 'added':
          tiles.push({ name: 'Radarr', description: 'Radarr • Added' });
          break;
        case 'missing':
          tiles.push({ name: 'Radarr', description: 'Radarr • Missing' });
          if (!this.config.radarr.searchOnAdd) {
            tiles.push({
              name: 'Radarr',
              description: 'Search in Radarr',
              externalUrl: `${this.config.publicBaseUrl}/action/movie/${encodeURIComponent(parsed.rawId)}`,
              isAction: true
            });
          }
          break;
        case 'not_added':
          tiles.push({
            name: 'Radarr',
            description: 'Add to Radarr + Search',
            externalUrl: `${this.config.publicBaseUrl}/action/movie/${encodeURIComponent(parsed.rawId)}`,
            isAction: true
          });
          break;
        case 'unavailable':
          tiles.push({ name: 'Radarr', description: 'Radarr • Unavailable' });
          break;
      }
      return tiles;
    }

    if (!this.config.sonarr.enabled) return [];
    const status = await this.sonarr.getEpisodeStatus(parsed.imdbId, parsed.season, parsed.episode);
    const tiles: StatusTile[] = [];
    switch (status.state) {
      case 'episode_downloaded':
        tiles.push({ name: 'Sonarr', description: 'Sonarr • Episode Downloaded' });
        break;
      case 'episode_missing':
        tiles.push({ name: 'Sonarr', description: 'Sonarr • Episode Missing' });
        break;
      case 'series_added':
        tiles.push({ name: 'Sonarr', description: 'Sonarr • Series Added' });
        break;
      case 'series_not_added':
        tiles.push({
          name: 'Sonarr',
          description: 'Add to Sonarr + Search',
          externalUrl: `${this.config.publicBaseUrl}/action/series/${encodeURIComponent(parsed.rawId)}`,
          isAction: true
        });
        break;
      case 'unavailable':
        tiles.push({ name: 'Sonarr', description: 'Sonarr • Unavailable' });
        break;
    }

    return tiles;
  }

  async triggerAdd(parsed: ParsedStremioId): Promise<AddActionResult> {
    if (parsed.kind === 'movie') {
      return this.radarr.addMovieByImdbId(parsed.imdbId);
    }
    return this.sonarr.addSeriesByImdbId(parsed.imdbId);
  }

  buildReturnLink(parsed: ParsedStremioId): string {
    return toStremioDetailLink(parsed);
  }
}
