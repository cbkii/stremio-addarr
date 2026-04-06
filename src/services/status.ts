import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
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

  buildActionLink(action: 'search' | 'add-search', parsed: ParsedStremioId): string {
    return `${this.config.publicBaseUrl}/action/${action}/${parsed.kind}/${encodeURIComponent(parsed.rawId)}`;
  }

  private buildKodiExternalUris(): Array<{ uri: string; name?: string }> {
    if (!this.config.kodi.enabled) {
      return [];
    }
    return [
      {
        name: 'Kodi',
        uri: `intent://launch#Intent;package=${encodeURIComponent(this.config.kodi.packageName)};action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`
      }
    ];
  }

  private buildMovieTiles(status: ArrMovieStatus, parsed: ParsedStremioId): StatusTile[] {
    switch (status.state) {
      case 'downloaded':
        return [{ name: '✅ Downloaded', externalUris: this.buildKodiExternalUris() }];
      case 'downloading':
        return [{ name: '⁉️⏱️ Downloading for Kodi' }];
      case 'missing':
        return [{ name: '⭕🔍 Search on Radarr', url: this.buildActionLink('search', parsed), isAction: true }];
      case 'added':
        return [{ name: '⭕🔍 Search on Radarr', url: this.buildActionLink('search', parsed), isAction: true }];
      case 'not_added':
        return [
          {
            name: '‼️➕🔍 Add+Search Radarr',
            url: this.buildActionLink('add-search', parsed),
            isAction: true
          }
        ];
      case 'unavailable':
      default:
        return [{ name: '🛑 Arr Down', description: 'Radarr unreachable' }];
    }
  }

  private buildSeriesTiles(status: ArrEpisodeStatus, parsed: ParsedStremioId): StatusTile[] {
    switch (status.state) {
      case 'episode_downloaded':
        return [{ name: '✅ Downloaded', externalUris: this.buildKodiExternalUris() }];
      case 'episode_downloading':
        return [{ name: '⁉️⏱️ Downloading for Kodi' }];
      case 'episode_missing':
        return [{ name: '⭕🔍 Search on Sonarr', url: this.buildActionLink('search', parsed), isAction: true }];
      case 'series_added':
      case 'episode_monitored':
        return [{ name: '⭕🔍 Search on Sonarr', url: this.buildActionLink('search', parsed), isAction: true }];
      case 'series_not_added':
        return [
          {
            name: '‼️➕🔍 Add+Search Sonarr',
            url: this.buildActionLink('add-search', parsed),
            isAction: true
          }
        ];
      case 'unavailable':
      default:
        return [{ name: '🛑 Arr Down', description: 'Sonarr unreachable' }];
    }
  }

  private bothDisabled(): boolean {
    return !this.config.radarr.enabled && !this.config.sonarr.enabled;
  }

  async buildTiles(parsed: ParsedStremioId): Promise<StatusTile[]> {
    if (this.bothDisabled()) {
      return [];
    }

    if (parsed.kind === 'movie') {
      if (!this.config.radarr.enabled) {
        return [];
      }
      const health = await this.getServiceHealth();
      if (!health.radarr.reachable) {
        return [{ name: '🛑 Arr Down', description: 'Radarr unreachable' }];
      }
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      return this.buildMovieTiles(status, parsed);
    }

    if (!this.config.sonarr.enabled) {
      return [];
    }

    const health = await this.getServiceHealth();
    if (!health.sonarr.reachable) {
      return [{ name: '🛑 Arr Down', description: 'Sonarr unreachable' }];
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

  async triggerSearch(parsed: ParsedStremioId): Promise<AddActionResult> {
    if (parsed.kind === 'movie') {
      const result = await this.radarr.triggerMovieSearch(parsed.imdbId);
      this.invalidateStatusCaches();
      return result;
    }
    const result = await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode);
    this.invalidateStatusCaches();
    return result;
  }

  async triggerAddAndSearch(parsed: ParsedStremioId): Promise<AddActionResult> {
    const added = await this.triggerAdd(parsed);
    if (!added.ok) {
      return added;
    }
    const searched = await this.triggerSearch(parsed);
    return searched.ok
      ? { ...searched, title: added.alreadyExisted ? searched.title : 'Added + search triggered' }
      : searched;
  }

  invalidateStatusCaches(): void {
    this.healthCache.clear();
    this.radarr.invalidateCache();
    this.sonarr.invalidateCache();
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
