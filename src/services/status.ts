import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { buildFileToken } from '../lib/file-tokens.js';
import type { AddActionResult, ArrEpisodeStatus, ArrMovieStatus, ParsedStremioId, ServiceHealth, StatusTile } from '../types.js';
import { RadarrClient } from './radarr.js';
import { SonarrClient } from './sonarr.js';
import { TmdbApiLookup, type TmdbLookup } from './tmdb.js';
import { TraktHtmlLookup, TraktApiLookup, type TraktLookup } from './trakt.js';
import { NoopWatchedLookup, type WatchedLookup } from './watched.js';

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

function formatReleaseDate(value: string | undefined, timeZone: string): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, , day] = value.split('-');
    const month = new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' })
      .format(new Date(`${value}T00:00:00Z`));
    return `${day} ${month} ${year.slice(-2)}`;
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return undefined;
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit',
      timeZone
    }).formatToParts(new Date(parsed));
  } catch {
    parts = new Intl.DateTimeFormat('en-GB', {
      day: '2-digit',
      month: 'short',
      year: '2-digit'
    }).formatToParts(new Date(parsed));
  }
  const day = parts.find((part) => part.type === 'day')?.value;
  const month = parts.find((part) => part.type === 'month')?.value;
  const year = parts.find((part) => part.type === 'year')?.value;
  if (!day || !month || !year) return undefined;
  return `${day} ${month} ${year}`;
}

/**
 * First line of a movie tile description: emoji + title + release date, ≤32 chars.
 */
function movieLine(title: string | undefined, releaseDate: string | undefined, timeZone: string): string {
  if (!title) {
    // For not-yet-added items only show a date if one was resolved; omit the
    // ?📅 placeholder because the item is unknown to Radarr, not just undated.
    const formattedDate = formatReleaseDate(releaseDate, timeZone);
    return formattedDate ? `📽 Not in Radarr (${formattedDate})` : '📽 Not in Radarr';
  }
  const release = formatReleaseDate(releaseDate, timeZone) ?? ' ?📅 ';
  const suffix = ` (${release})`;
  // Use codepoint length to keep arithmetic consistent with truncate().
  const maxTitle = 32 - 3 - Array.from(suffix).length; // 3 = '📽 ' (one emoji codepoint + space)
  return `📽 ${truncate(title, maxTitle)}${suffix}`;
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

function episodeLineLabel(season: number | undefined, episode: number | undefined, releaseDate: string | undefined, timeZone: string): string {
  const episodeTag = epLabel(season, episode);
  if (!episodeTag) return '';
  const release = formatReleaseDate(releaseDate, timeZone) ?? '?📅';
  return `${episodeTag} (${release})`;
}

/**
 * Normalize a URL-ish text for compact card display.
 */
function cardEndpointLine(raw: string): string {
  const value = raw.trim().replace(/\/+$/, '');
  const display = value.replace(/^https?:\/\//i, '');
  return `└─── 📲  ${display}`;
}

function watchedLine(watched: boolean, borderFallback: boolean): string {
  if (borderFallback) return '════════════════════';
  return watched ? '══ 👁️ WATCHED ════════' : '══ 🆕 UNWATCHED ══════';
}

/**
 * Join non-empty lines into a newline-separated description.
 */
function desc(...lines: string[]): string {
  return lines.filter(Boolean).join('\n');
}

export class ArrStatusService {
  private readonly radarr: RadarrClient;
  private readonly sonarr: SonarrClient;
  private readonly healthCache: TtlCache<{ radarr: ServiceHealth; sonarr: ServiceHealth }>;
  private readonly watchedLookup: WatchedLookup;
  private readonly traktLookup: TraktLookup;
  private readonly tmdbLookup?: TmdbLookup;

  constructor(private readonly config: AppConfig, deps?: { watchedLookup?: WatchedLookup; traktLookup?: TraktLookup; tmdbLookup?: TmdbLookup }) {
    this.radarr = new RadarrClient(config);
    this.sonarr = new SonarrClient(config);
    this.healthCache = new TtlCache(config.serviceHealthCacheTtlMs);
    this.watchedLookup = deps?.watchedLookup ?? new NoopWatchedLookup();
    this.traktLookup = deps?.traktLookup ?? (config.traktSync.clientId ? new TraktApiLookup(config.traktSync.clientId) : new TraktHtmlLookup());
    this.tmdbLookup = deps?.tmdbLookup ?? (config.tmdb.authToken ? new TmdbApiLookup(config.tmdb.authToken, config.tmdb.apiBaseUrl, config.tmdb.region) : undefined);
  }

  private normalizeDateCandidate(value?: string): string | undefined {
    if (!value) return undefined;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      const parsed = Date.parse(`${value}T00:00:00Z`);
      if (!Number.isFinite(parsed)) return undefined;
      const year = Number(value.slice(0, 4));
      if (!Number.isFinite(year) || year <= 1901) return undefined;
      return value;
    }
    const parsed = Date.parse(value);
    if (!Number.isFinite(parsed)) return undefined;
    const year = new Date(parsed).getUTCFullYear();
    if (!Number.isFinite(year) || year <= 1901) return undefined;
    return value;
  }

  private async resolveMovieReleaseDate(imdbId: string, arrReleaseDate?: string): Promise<string> {
    const arr = this.normalizeDateCandidate(arrReleaseDate);
    if (arr) return arr;
    const trakt = await this.traktLookup.getMovieReleaseDate(imdbId);
    const traktDate = this.normalizeDateCandidate(trakt);
    if (traktDate) return traktDate;
    if (this.tmdbLookup) {
      const tmdb = await this.tmdbLookup.getMovieReleaseDate(imdbId);
      const tmdbDate = this.normalizeDateCandidate(tmdb);
      if (tmdbDate) return tmdbDate;
    }
    return ' ?📅 ';
  }

  private async resolveEpisodeReleaseDate(imdbId: string, season?: number, episode?: number, arrReleaseDate?: string): Promise<string> {
    const arr = this.normalizeDateCandidate(arrReleaseDate);
    if (arr) return arr;
    const trakt = await this.traktLookup.getEpisodeReleaseDate(imdbId, season, episode);
    const traktDate = this.normalizeDateCandidate(trakt);
    if (traktDate) return traktDate;
    if (this.tmdbLookup) {
      const tmdb = await this.tmdbLookup.getEpisodeReleaseDate(imdbId, season, episode);
      const tmdbDate = this.normalizeDateCandidate(tmdb);
      if (tmdbDate) return tmdbDate;
    }
    return ' ?📅 ';
  }

  private useBorderFallbackLine(): boolean {
    const diagnostics = this.watchedLookup.getDiagnostics?.();
    return diagnostics?.provider === 'trakt' && Boolean(diagnostics.lastSyncError);
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

  private buildKodiExternalUrl(): string | undefined {
    if (!this.config.kodi.enabled) {
      return undefined;
    }
    return `intent://launch#Intent;package=${encodeURIComponent(this.config.kodi.packageName)};action=android.intent.action.MAIN;category=android.intent.category.LAUNCHER;end`;
  }

  private radarrCardLine(): string {
    return cardEndpointLine(this.config.radarr.cardUrl || this.config.radarr.baseUrl);
  }

  private sonarrCardLine(): string {
    return cardEndpointLine(this.config.sonarr.cardUrl || this.config.sonarr.baseUrl);
  }

  private buildMovieTiles(status: ArrMovieStatus, parsed: ParsedStremioId, watched: boolean, borderFallback: boolean): StatusTile[] {
    switch (status.state) {
      case 'downloaded': {
        const fileUrl = (this.canDirectStream() && status.movieFileId != null)
          ? this.buildFileStreamUrl('movie', status.movieFileId)
          : undefined;
        const kodiExternalUrl = this.canUseKodiFallback(fileUrl) ? this.buildKodiExternalUrl() : undefined;
        return [{
          name: '✅🟢\nFile\nReady',
          description: desc(
            watchedLine(watched, borderFallback),
            movieLine(status.title, status.releaseDate, this.config.timeZone),
            '✅ File is downloaded',
            fileUrl ? '🗯️ ▶️  PLAY FROM PI ►' : (kodiExternalUrl ? '🗯️ ▶️  OPEN IN KODI ►' : '🗯️ ▶️  PLAY FROM PI ►')
          ),
          url: fileUrl,
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : undefined,
          externalUrl: kodiExternalUrl
        }];
      }
      case 'downloading':
        return [{
          name: '⏱️📥...\nDLing',
          description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '🗯️⏱️ DOWNLOAD IN PROGRESS…', this.radarrCardLine())
        }];
      case 'missing':
        return [{
          name: '🔍🦜\nSearch\nDownload',
          description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ Monitored — file missing', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'added':
        return [{
          name: '🔍🦜\nSearch\nDownload',
          description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ In Library — not monitored', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'not_added':
        return [{
          name: '➕ Add +\nDownload',
          description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '🗯️ ➕  ADD + SEARCH ►', this.radarrCardLine()),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑❌\nRadarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Radarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.radarrCardLine()) }];
    }
  }

  private buildSeriesTiles(status: ArrEpisodeStatus, parsed: ParsedStremioId, watched: boolean, borderFallback: boolean): StatusTile[] {
    const ep = episodeLineLabel(parsed.season, parsed.episode, status.episodeReleaseDate, this.config.timeZone);
    switch (status.state) {
      case 'episode_downloaded': {
        const fileUrl = (this.canDirectStream() && status.episodeFileId != null)
          ? this.buildFileStreamUrl('series', status.episodeFileId)
          : undefined;
        const kodiExternalUrl = this.canUseKodiFallback(fileUrl) ? this.buildKodiExternalUrl() : undefined;
        return [{
          name: '✅🟢\nFile\nReady',
          description: desc(
            watchedLine(watched, borderFallback),
            seriesLine(status.title),
            ep ? `✅ ${ep} is downloaded` : '✅ File is downloaded',
            fileUrl ? '🗯️ ▶️  PLAY FROM PI ►' : (kodiExternalUrl ? '🗯️ ▶️  OPEN IN KODI ►' : '🗯️ ▶️  PLAY FROM PI ►')
          ),
          url: fileUrl,
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : undefined,
          externalUrl: kodiExternalUrl
        }];
      }
      case 'episode_downloading':
        return [{
          name: '⏱️📥...\nDLing',
          description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `🗯️ ⏱  ${ep} DOWNLOADING…` : '🗯️⏱️ DOWNLOAD IN PROGRESS…', this.sonarrCardLine())
        }];
      case 'episode_missing':
        return [{
          name: '🔍🦜\nSearch\nDownload',
          description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_added':
      case 'episode_monitored':
        return [{
          name: '🔍🦜\nSearch\nDownload',
          description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),
          url: this.buildActionLink('search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'series_not_added':
        return [{
          name: '➕ Add +\nDownload',
          description: desc(watchedLine(watched, borderFallback), '📺  Not in Sonarr', ep, '🗯️ ➕  ADD SERIES + SEARCH ►', this.sonarrCardLine()),
          url: this.buildActionLink('add-search', parsed),
          behaviorHints: { notWebReady: true },
          isAction: true
        }];
      case 'unavailable':
      default:
        return [{ name: '🛑❌\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()) }];
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
      const [watched, health] = await Promise.all([
        this.watchedLookup.isMovieWatched(parsed.imdbId),
        this.getServiceHealth()
      ]);
      const borderFallback = this.useBorderFallbackLine();
      if (!health.radarr.reachable) {
        return [{ name: '🛑❌\nRadarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Radarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.radarrCardLine()) }];
      }
      const status = await this.radarr.getMovieStatus(parsed.imdbId);
      const releaseDate = await this.resolveMovieReleaseDate(parsed.imdbId, status.releaseDate);
      return this.buildMovieTiles({ ...status, releaseDate }, parsed, watched, borderFallback);
    }

    if (!this.config.sonarr.enabled) {
      return [];
    }

    const [watched, health] = await Promise.all([
      this.watchedLookup.isEpisodeWatched(parsed.imdbId, parsed.season, parsed.episode),
      this.getServiceHealth()
    ]);
    const borderFallback = this.useBorderFallbackLine();
    if (!health.sonarr.reachable) {
      return [{ name: '🛑❌\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()) }];
    }

    const status = await this.sonarr.getEpisodeStatus(parsed.imdbId, parsed.season, parsed.episode);
    const episodeReleaseDate = await this.resolveEpisodeReleaseDate(parsed.imdbId, parsed.season, parsed.episode, status.episodeReleaseDate);
    return this.buildSeriesTiles({ ...status, episodeReleaseDate }, parsed, watched, borderFallback);
  }

  async triggerAdd(parsed: ParsedStremioId): Promise<AddActionResult> {
    if (parsed.kind === 'movie') {
      return this.radarr.addMovieByImdbId(parsed.imdbId);
    }
    return this.sonarr.addSeriesByImdbId(parsed.imdbId, { season: parsed.season, episode: parsed.episode });
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

    const [radarrPing, sonarrPing] = await Promise.all([
      this.radarr.ping(),
      this.sonarr.ping()
    ]);
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
