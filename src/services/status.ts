import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { buildFileToken } from '../lib/file-tokens.js';
import type { AddActionResult, ArrEpisodeStatus, ArrMovieStatus, ParsedStremioId, ServiceHealth, StatusTile } from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';

// --- Tile formatting helpers ---

/**
 * Truncate a string to at most maxLen codepoints, appending '…' if trimmed.
 */
function truncate(s: string, maxLen: number): string {
  const cps = Array.from(s);
  if (cps.length <= maxLen) return s;
  if (maxLen <= 1) return '…';
  return cps.slice(0, maxLen - 1).join('') + '…';
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

  buildFileStreamUrl(kind: 'movie' | 'series', fileId: number): string {
    const token = buildFileToken(this.config.fileStreaming.secret, kind, fileId);
    return `${this.config.publicBaseUrl}/files/${kind}/${fileId}?t=${token}`;
  }

  private canDirectStream(): boolean {
    return this.config.fileStreaming.enabled && this.config.fileStreaming.playbackMode === 'direct';
  }

  private canUseKodiFallback(fileUrl?: string): boolean {
    if (!this.config.kodi.enabled) return false;
    // Keep downloaded tiles actionable whenever a direct file URL is unavailable.
    return !fileUrl;
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
        const fileUrl = (this.canDirectStream() && status.movieFileId != null)
          ? this.buildFileStreamUrl('movie', status.movieFileId)
          : undefined;
        const kodiUris = this.canUseKodiFallback(fileUrl) ? this.buildKodiExternalUris() : [];
        return [{
          name: '✅\nDone',
          description: desc(
            movieLine(status.title, status.year),
            '✅ File ready',
            fileUrl ? '▶ Play on Pi' : (kodiUris.length > 0 ? '▶ Open in Kodi' : '✅ Ready')
          ),
          url: fileUrl,
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : undefined,
          externalUris: kodiUris
        }];
      }
      case 'downloading':
        return [{
          name: '⏱️\nLoad',
          description: desc(movieLine(status.title, status.year), '⏱ Downloading now')
        }];
      case 'missing':
        return [{
          name: '🔍\nSearch\nRadarr',
          description: desc(movieLine(status.title, status.year), '⭕ Monitored, missing', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'added':
        return [{
          name: '🔍\nSearch\nRadarr',
          description: desc(movieLine(status.title, status.year), '⭕ Added, unmonitored', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'not_added':
        return [{
          name: '➕\nAdd\nRadarr',
          description: desc('📽 Not in Radarr', '➕ Tap to add+search'),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑\nDown', description: desc('🛑 Radarr unreachable', '🔧 Check config') }];
    }
  }

  private buildSeriesTiles(status: ArrEpisodeStatus, parsed: ParsedStremioId): StatusTile[] {
    const ep = epLabel(parsed.season, parsed.episode);
    switch (status.state) {
      case 'episode_downloaded': {
        const fileUrl = (this.canDirectStream() && status.episodeFileId != null)
          ? this.buildFileStreamUrl('series', status.episodeFileId)
          : undefined;
        const kodiUris = this.canUseKodiFallback(fileUrl) ? this.buildKodiExternalUris() : [];
        return [{
          name: '✅\nDone',
          description: desc(
            seriesLine(status.title),
            ep ? `✅ ${ep} ready` : '✅ File ready',
            fileUrl ? '▶ Play on Pi' : (kodiUris.length > 0 ? '▶ Open in Kodi' : '✅ Ready')
          ),
          url: fileUrl,
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : undefined,
          externalUris: kodiUris
        }];
      }
      case 'episode_downloading':
        return [{
          name: '⏱️\nLoad',
          description: desc(seriesLine(status.title), ep ? `⏱ ${ep} downloading` : '⏱ Downloading now')
        }];
      case 'episode_missing':
        return [{
          name: '🔍\nSearch\nSonarr',
          description: desc(seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_added':
      case 'episode_monitored':
        return [{
          name: '🔍\nSearch\nSonarr',
          description: desc(seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', '🔍 Tap to search'),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_not_added':
        return [{
          name: '➕\nAdd\nSonarr',
          description: desc('📺 Not in Sonarr', '➕ Tap to add+search'),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑\nDown', description: desc('🛑 Sonarr unreachable', '🔧 Check config') }];
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
        return [{ name: '🛑\nDown', description: desc('🛑 Radarr unreachable', '🔧 Check config') }];
      }
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      return this.buildMovieTiles(status, parsed);
    }

    if (!this.config.sonarr.enabled) {
      return [];
    }

    const health = await this.getServiceHealth();
    if (!health.sonarr.reachable) {
      return [{ name: '🛑\nDown', description: desc('🛑 Sonarr unreachable', '🔧 Check config') }];
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

  async getMovieFilePath(movieFileId: number): Promise<string | null> {
    return this.radarr.getMovieFilePath(movieFileId);
  }

  async getEpisodeFilePath(episodeFileId: number): Promise<string | null> {
    return this.sonarr.getEpisodeFilePath(episodeFileId);
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
