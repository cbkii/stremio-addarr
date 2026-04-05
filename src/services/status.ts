import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { toStremioDetailLink } from '../lib/stremio-ids.js';
import type { AddActionResult, ArrEpisodeStatus, ArrMovieStatus, ParsedStremioId, ServiceHealth, StatusTile } from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';

export class ArrStatusService {
  private readonly radarr: RadarrClient;
  private readonly sonarr: SonarrClient;
  private readonly healthCache: TtlCache<{ radarr: ServiceHealth; sonarr: ServiceHealth }>;

  constructor(private readonly config: AppConfig) {
    this.radarr = new RadarrClient(config);
    this.sonarr = new SonarrClient(config);
    this.healthCache = new TtlCache(config.serviceHealthCacheTtlMs);
  }

  buildActionLink(parsed: ParsedStremioId): string {
    return `${this.config.publicBaseUrl}/action/${parsed.kind}/${encodeURIComponent(parsed.rawId)}`;
  }

  private buildMovieTiles(status: ArrMovieStatus, parsed: ParsedStremioId): StatusTile[] {
    switch (status.state) {
      case 'downloaded':
        return [{ name: '✅ Radarr • Downloaded', description: 'On disk' }];
      case 'missing':
        return [{ name: '🔎 Radarr • Missing', description: 'Monitored, searching' }];
      case 'added':
        return [{ name: '📌 Radarr • Added', description: 'In library' }];
      case 'not_added':
        return [
          {
            name: '➕ Add to Radarr + Search',
            description: 'One-click add',
            externalUrl: this.buildActionLink(parsed),
            isAction: true
          }
        ];
      case 'unavailable':
      default:
        return [{ name: '🛑 Arr Offline', description: 'Radarr unreachable' }];
    }
  }

  private buildSeriesTiles(status: ArrEpisodeStatus, parsed: ParsedStremioId): StatusTile[] {
    switch (status.state) {
      case 'episode_downloaded':
        return [{ name: '✅ Sonarr • Episode Downloaded', description: 'On disk' }];
      case 'episode_missing':
        return [{ name: '🔎 Sonarr • Episode Missing', description: 'Monitored, searching' }];
      case 'series_added':
      case 'episode_monitored':
        return [{ name: '📌 Sonarr • Series Added', description: 'In library' }];
      case 'series_not_added':
        return [
          {
            name: '➕ Add to Sonarr + Search',
            description: 'One-click add',
            externalUrl: this.buildActionLink(parsed),
            isAction: true
          }
        ];
      case 'unavailable':
      default:
        return [{ name: '🛑 Arr Offline', description: 'Sonarr unreachable' }];
    }
  }

  private bothDisabled(): boolean {
    return !this.config.radarr.enabled && !this.config.sonarr.enabled;
  }

  private async bothUnreachable(): Promise<boolean> {
    const health = await this.getServiceHealth();
    return !health.radarr.reachable && !health.sonarr.reachable;
  }

  async buildTiles(parsed: ParsedStremioId): Promise<StatusTile[]> {
    if (this.bothDisabled()) {
      return [];
    }

    if (await this.bothUnreachable()) {
      return [];
    }

    if (parsed.kind === 'movie') {
      if (!this.config.radarr.enabled) {
        return [];
      }
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      return this.buildMovieTiles(status, parsed);
    }

    if (!this.config.sonarr.enabled) {
      return [];
    }

    const status = await this.sonarr.getEpisodeStatus(parsed.imdbId, parsed.season, parsed.episode);
    return this.buildSeriesTiles(status, parsed);
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

  async getServiceHealth(): Promise<{ radarr: ServiceHealth; sonarr: ServiceHealth }> {
    const cached = this.healthCache.get('services');
    if (cached) {
      return cached;
    }

    const radarrPing = await this.radarr.ping();
    const sonarrPing = await this.sonarr.ping();
    const value = {
      radarr: {
        configured: this.config.radarr.enabled,
        reachable: radarrPing.reachable,
        detail: radarrPing.detail
      },
      sonarr: {
        configured: this.config.sonarr.enabled,
        reachable: sonarrPing.reachable,
        detail: sonarrPing.detail
      }
    };
    this.healthCache.set('services', value);
    return value;
  }
}
