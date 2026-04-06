import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import type { AddActionResult, ArrEpisodeStatus, ArrMovieStatus, ParsedStremioId, ServiceHealth, StatusTile } from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';

// --- Tile formatting helpers ---

/**
 * Truncate a string to at most maxLen codepoints, appending '…' if trimmed.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 1) + '…';
}

/**
 * First line of a movie tile description: emoji + title + year, ≤32 chars.
 */
function movieLine(title?: string, year?: number): string {
  if (!title) return '📽 Not in Radarr';
  const yearStr = year ? ` (${year})` : '';
  const maxTitle = 32 - 3 - yearStr.length; // 3 = '📽 '.length (emoji is 2 UTF-16 units + space)
  return `📽 ${truncate(title, maxTitle)}${yearStr}`;
}

/**
 * First line of a series tile description: emoji + title, ≤32 chars.
 */
function seriesLine(title?: string): string {
  if (!title) return '📺 Not in Sonarr';
  return `📺 ${truncate(title, 29)}`; // 3 = '📺 '.length (emoji is 2 UTF-16 units + space), title ≤ 29
}

/**
 * Season+episode label e.g. 'S01E02', or '' if not provided.
 */
function epLabel(season?: number, episode?: number): string {
  if (season == null || episode == null) return '';
  return `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`;
}

/**
 * Join up to 3 non-empty lines into a newline-separated description.
 */
function desc(...lines: string[]): string {
  return lines.filter(Boolean).slice(0, 3).join('\n');
}

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
      case 'downloaded': {
        const kodiUris = this.buildKodiExternalUris();
        return [{
          name: '✅\nDown\nload',
          description: desc(
            movieLine(status.title, status.year),
            '✅ File ready',
            kodiUris.length > 0 ? '▶ Open in Kodi' : ''
          ),
          externalUris: kodiUris
        }];
      }
      case 'downloading':
        return [{
          name: '⏱️\nDLing',
          description: desc(movieLine(status.title, status.year), '⏱ Downloading now')
        }];
      case 'missing':
        return [{
          name: '🔍\nSrch\nRadar',
          description: desc(movieLine(status.title, status.year), '⭕ Monitored, missing', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'added':
        return [{
          name: '🔍\nSrch\nRadar',
          description: desc(movieLine(status.title, status.year), '⭕ Added, unmonitored', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'not_added':
        return [{
          name: '➕\nAdd+\nRadar',
          description: desc('📽 Not in Radarr', '➕ Tap to add+search'),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑\nArr\nDown', description: desc('🛑 Radarr unreachable', '🔧 Check config') }];
    }
  }

  private buildSeriesTiles(status: ArrEpisodeStatus, parsed: ParsedStremioId): StatusTile[] {
    const ep = epLabel(parsed.season, parsed.episode);
    switch (status.state) {
      case 'episode_downloaded': {
        const kodiUris = this.buildKodiExternalUris();
        return [{
          name: '✅\nDown\nload',
          description: desc(
            seriesLine(status.title),
            ep ? `✅ ${ep} ready` : '✅ File ready',
            kodiUris.length > 0 ? '▶ Open in Kodi' : ''
          ),
          externalUris: kodiUris
        }];
      }
      case 'episode_downloading':
        return [{
          name: '⏱️\nDLing',
          description: desc(seriesLine(status.title), ep ? `⏱ ${ep} downloading` : '⏱ Downloading now')
        }];
      case 'episode_missing':
        return [{
          name: '🔍\nSrch\nSonar',
          description: desc(seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_added':
      case 'episode_monitored':
        return [{
          name: '🔍\nSrch\nSonar',
          description: desc(seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_not_added':
        return [{
          name: '➕\nAdd+\nSonar',
          description: desc('📺 Not in Sonarr', '➕ Tap to add+search'),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑\nArr\nDown', description: desc('🛑 Sonarr unreachable', '🔧 Check config') }];
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
        return [{ name: '🛑\nArr\nDown', description: desc('🛑 Radarr unreachable', '🔧 Check config') }];
      }
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      return this.buildMovieTiles(status, parsed);
    }

    if (!this.config.sonarr.enabled) {
      return [];
    }

    const health = await this.getServiceHealth();
    if (!health.sonarr.reachable) {
      return [{ name: '🛑\nArr\nDown', description: desc('🛑 Sonarr unreachable', '🔧 Check config') }];
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
