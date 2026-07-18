import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import type { AppConfig } from '../config.js';
import type { WatchedLookup, WatchedLookupDiagnostics } from './watched.js';
import { normalizeImdbId } from '../lib/imdb.js';
import {
  TraktAuthError,
  refreshTraktToken,
  traktApiHeaders,
  traktJsonRequest,
  traktTokenTiming,
  type TraktTokenResponse
} from './trakt-auth.js';

interface PersistedTraktState {
  schemaVersion?: number;
  authGeneration?: string;
  lastSyncAt?: number;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
  tokenRefreshAt?: number;
}

interface TraktWatchedMovie {
  movie?: { ids?: { imdb?: string } };
}

interface TraktWatchedShow {
  show?: { ids?: { imdb?: string } };
  seasons?: Array<{ number?: number; episodes?: Array<{ number?: number }> }>;
}

export interface TraktWatchedOptions {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export class TraktWatchedLookup implements WatchedLookup {
  private readonly syncMs: number;
  private readonly stateFile: string;
  private readonly now: () => number;
  private readonly sleep?: (ms: number) => Promise<void>;
  private readonly userAgent: string;
  private movieWatched = new Set<string>();
  private episodeWatched = new Set<string>();
  private accessToken: string;
  private tokenExpiresAt: number;
  /** Refresh threshold, deliberately before the provider's absolute expiry. */
  private tokenRefreshAt: number;
  private refreshToken: string;
  private lastSyncAt = 0;
  private lastSyncError?: string;
  private runningSync: Promise<void> | null = null;
  private runningRefresh: Promise<void> | null = null;
  private snapshotReady = false;

  constructor(
    private readonly config: AppConfig,
    private readonly logger: Logger,
    options: TraktWatchedOptions = {}
  ) {
    this.syncMs = config.traktSync.syncMins * 60_000;
    this.stateFile = config.traktSync.stateFilePath;
    this.refreshToken = config.traktSync.refreshToken;
    this.accessToken = config.traktSync.accessToken;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep;
    this.userAgent = `stremio-addarr/${config.version}`;
    const initialTiming = this.initialTokenTiming();
    this.tokenExpiresAt = initialTiming.expiresAtMs;
    this.tokenRefreshAt = initialTiming.refreshAtMs;
  }

  async init(): Promise<void> {
    await this.loadState();
  }

  async triggerSync(): Promise<void> {
    await this.ensureSynced(true);
  }

  async isMovieWatched(imdbId: string): Promise<boolean> {
    if (!this.config.traktSync.enabled) return false;
    const normalized = normalizeImdbId(imdbId);
    if (!normalized) return false;
    await this.ensureSynced(false);
    return this.movieWatched.has(normalized);
  }

  async areMoviesWatched(imdbIds: readonly string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (imdbIds.length === 0) return result;
    if (!this.config.traktSync.enabled) {
      for (const id of imdbIds) result.set(id, false);
      return result;
    }

    const normalizedIds = imdbIds.map(id => ({ original: id, normalized: normalizeImdbId(id) }));
    if (normalizedIds.every(id => !id.normalized)) {
      for (const id of imdbIds) result.set(id, false);
      return result;
    }

    await this.ensureSynced(false);
    for (const { original, normalized } of normalizedIds) {
      result.set(original, normalized ? this.movieWatched.has(normalized) : false);
    }
    return result;
  }

  async isEpisodeWatched(imdbId: string, season?: number, episode?: number): Promise<boolean> {
    if (!this.config.traktSync.enabled) return false;
    const normalized = normalizeImdbId(imdbId);
    if (!normalized || season == null || episode == null) return false;
    await this.ensureSynced(false);
    return this.episodeWatched.has(this.episodeKey(normalized, season, episode));
  }

  getDiagnostics(): WatchedLookupDiagnostics {
    const next = this.lastSyncAt > 0 ? this.lastSyncAt + this.syncMs : undefined;
    return {
      enabled: this.config.traktSync.enabled,
      provider: this.config.traktSync.enabled ? 'trakt' : 'noop',
      syncMins: this.config.traktSync.syncMins,
      lastSyncAt: this.lastSyncAt > 0 ? new Date(this.lastSyncAt).toISOString() : undefined,
      nextSyncAt: next ? new Date(next).toISOString() : undefined,
      lastSyncError: this.lastSyncError
    };
  }

  private initialTokenTiming(): { expiresAtMs: number; refreshAtMs: number } {
    if (!this.accessToken || this.config.traktSync.accessTokenCreatedAt <= 0
      || this.config.traktSync.accessTokenExpiresIn <= 0) {
      return { expiresAtMs: 0, refreshAtMs: 0 };
    }
    const timing = traktTokenTiming({
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      created_at: this.config.traktSync.accessTokenCreatedAt,
      expires_in: this.config.traktSync.accessTokenExpiresIn
    }, this.now());
    return { expiresAtMs: timing.expiresAtMs, refreshAtMs: timing.refreshAtMs };
  }

  private async ensureSynced(force: boolean): Promise<void> {
    if (!this.config.traktSync.enabled) return;
    const now = this.now();
    if (!force && this.snapshotReady && this.lastSyncAt > 0 && (now - this.lastSyncAt) < this.syncMs) return;
    if (this.runningSync) return this.runningSync;
    this.runningSync = this.runSync();
    try {
      await this.runningSync;
    } finally {
      this.runningSync = null;
    }
  }

  private async runSync(): Promise<void> {
    const startedAt = this.now();
    this.logger.info('trakt sync start', { enabled: true });
    try {
      if (!this.accessToken || this.now() >= this.tokenRefreshAt) {
        await this.refreshAccessToken();
      }
      const [movies, shows] = await Promise.all([
        this.traktGet<TraktWatchedMovie[]>('/sync/watched/movies'),
        this.traktGet<TraktWatchedShow[]>('/sync/watched/shows')
      ]);
      const nextMovieWatched = new Set<string>();
      const nextEpisodeWatched = new Set<string>();
      for (const item of movies) {
        const imdb = normalizeImdbId(item.movie?.ids?.imdb);
        if (imdb) nextMovieWatched.add(imdb);
      }
      for (const item of shows) {
        const imdb = normalizeImdbId(item.show?.ids?.imdb);
        if (!imdb) continue;
        for (const season of item.seasons ?? []) {
          if (season.number == null) continue;
          for (const ep of season.episodes ?? []) {
            if (ep.number == null) continue;
            nextEpisodeWatched.add(this.episodeKey(imdb, season.number, ep.number));
          }
        }
      }

      this.movieWatched = nextMovieWatched;
      this.episodeWatched = nextEpisodeWatched;
      this.lastSyncAt = this.now();
      this.lastSyncError = undefined;
      this.snapshotReady = true;

      try {
        await this.persistState();
      } catch (error) {
        this.logger.warn('trakt sync metadata persistence failed (snapshot valid in-memory)', {
          error: error instanceof Error ? error.message : String(error)
        });
      }

      this.logger.info('trakt sync complete', {
        durationMs: this.now() - startedAt,
        movieCount: this.movieWatched.size,
        episodeCount: this.episodeWatched.size
      });
    } catch (error) {
      this.lastSyncError = this.describeAuthError(error);
      this.logger.warn('trakt sync failed', {
        durationMs: this.now() - startedAt,
        error: this.lastSyncError
      });
    }
  }

  private describeAuthError(error: unknown): string {
    if (error instanceof TraktAuthError) {
      if ((error.status === 400 || error.status === 401)
        && /invalid|grant|token|unauthor/i.test(`${error.code} ${error.responseText}`)) {
        return 'trakt_reauthorization_required';
      }
      return error.code ? `${error.message}: ${error.code}` : error.message;
    }
    return error instanceof Error ? error.message : String(error);
  }

  private async refreshAccessToken(): Promise<void> {
    if (this.runningRefresh) return this.runningRefresh;
    this.runningRefresh = this.performRefreshAccessToken();
    try {
      await this.runningRefresh;
    } finally {
      this.runningRefresh = null;
    }
  }

  private async performRefreshAccessToken(): Promise<void> {
    if (!this.refreshToken) throw new Error('missing_refresh_token');
    let response: TraktTokenResponse;
    try {
      response = await refreshTraktToken(
        this.config.traktSync.apiBaseUrl,
        this.config.traktSync.clientId,
        this.config.traktSync.clientSecret,
        this.refreshToken,
        this.config.traktSync.redirectUri,
        this.userAgent,
        {
          timeoutMs: this.config.requestTimeoutMs,
          sleep: this.sleep
        }
      );
    } catch (error) {
      if (error instanceof TraktAuthError && (error.status === 400 || error.status === 401)) {
        throw new Error('trakt_reauthorization_required');
      }
      throw error;
    }
    this.applyToken(response);

    try {
      await this.persistState();
    } catch (error) {
      this.logger.warn('trakt token refresh persistence failed', {
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private applyToken(response: TraktTokenResponse): void {
    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token;
    const timing = traktTokenTiming(response, this.now());
    this.tokenExpiresAt = timing.expiresAtMs;
    this.tokenRefreshAt = timing.refreshAtMs;
  }

  private async traktGet<T>(endpoint: string): Promise<T> {
    try {
      return await this.doTraktGet<T>(endpoint);
    } catch (error) {
      if (error instanceof TraktAuthError && error.status === 401) {
        await this.refreshAccessToken();
        return this.doTraktGet<T>(endpoint);
      }
      throw error;
    }
  }

  private doTraktGet<T>(endpoint: string): Promise<T> {
    return traktJsonRequest<T>(
      `${this.config.traktSync.apiBaseUrl}${endpoint}`,
      {
        method: 'GET',
        headers: traktApiHeaders(this.config.traktSync.clientId, this.userAgent, this.accessToken)
      },
      {
        timeoutMs: this.config.requestTimeoutMs,
        sleep: this.sleep
      }
    );
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTraktState;
      if (this.config.traktSync.authGeneration
        && parsed.authGeneration !== this.config.traktSync.authGeneration) {
        this.logger.info('ignored stale Trakt state after credential generation changed');
        return;
      }
      this.lastSyncAt = typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : 0;
      if (parsed.refreshToken?.trim()) this.refreshToken = parsed.refreshToken.trim();
      if (parsed.accessToken?.trim()) this.accessToken = parsed.accessToken.trim();
      // Legacy v1 state used an obsolete 90-day assumption. Refresh it immediately.
      if (parsed.schemaVersion === 2 && typeof parsed.tokenExpiresAt === 'number') {
        this.tokenExpiresAt = parsed.tokenExpiresAt;
        this.tokenRefreshAt = typeof parsed.tokenRefreshAt === 'number'
          ? parsed.tokenRefreshAt
          : Math.max(0, parsed.tokenExpiresAt - 5 * 60_000);
      } else {
        this.tokenExpiresAt = 0;
        this.tokenRefreshAt = 0;
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Trakt state could not be loaded; using environment credentials', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }

  private async persistState(): Promise<void> {
    const directory = path.dirname(this.stateFile);
    const createdDirectory = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (createdDirectory) await fs.chmod(directory, 0o700).catch(() => undefined);
    const temporary = `${this.stateFile}.tmp-${process.pid}-${Date.now()}`;
    const payload = JSON.stringify({
      schemaVersion: 2,
      authGeneration: this.config.traktSync.authGeneration,
      lastSyncAt: this.lastSyncAt,
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      tokenExpiresAt: this.tokenExpiresAt,
      tokenRefreshAt: this.tokenRefreshAt
    });
    try {
      const handle = await fs.open(temporary, 'w', 0o600);
      try {
        await handle.writeFile(payload, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temporary, this.stateFile);
      await fs.chmod(this.stateFile, 0o600);
    } finally {
      await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }

  private episodeKey(imdbId: string, season: number, episode: number): string {
    return `${imdbId}:${season}:${episode}`;
  }
}
