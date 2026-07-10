import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import type { AppConfig } from '../config.js';
import type { WatchedLookup, WatchedLookupDiagnostics } from './watched.js';

interface TraktTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
}

interface PersistedTraktState {
  lastSyncAt?: number;
  refreshToken?: string;
  accessToken?: string;
  tokenExpiresAt?: number;
}

interface TraktWatchedMovie {
  movie?: { ids?: { imdb?: string } };
}

interface TraktWatchedShow {
  show?: { ids?: { imdb?: string } };
  seasons?: Array<{ number?: number; episodes?: Array<{ number?: number }> }>;
}

// Trakt access tokens expire after 90 days.
const TRAKT_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const IMDB_ID_PATTERN = /^tt\d+$/i;

function normalizeImdbId(value?: string): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed || !IMDB_ID_PATTERN.test(trimmed)) return undefined;
  return `tt${trimmed.slice(2)}`;
}

export class TraktWatchedLookup implements WatchedLookup {
  private readonly syncMs: number;
  private readonly stateFile: string;
  private movieWatched = new Set<string>();
  private episodeWatched = new Set<string>();
  private accessToken = '';
  private tokenExpiresAt = 0;
  private refreshToken: string;
  private lastSyncAt = 0;
  private lastSyncError?: string;
  private runningSync: Promise<void> | null = null;
  private snapshotReady = false;

  constructor(private readonly config: AppConfig, private readonly logger: Logger) {
    this.syncMs = config.traktSync.syncMins * 60_000;
    this.stateFile = config.traktSync.stateFilePath;
    this.refreshToken = config.traktSync.refreshToken;
  }

  async init(): Promise<void> {
    await this.loadState();
  }

  async triggerSync(): Promise<void> {
    await this.ensureSynced(true);
  }

  async isMovieWatched(imdbId: string): Promise<boolean> {
    if (!this.config.traktSync.enabled) return false;
    // We do not normalize input lookup IDs here;
    // The previous implementation checked the un-normalized ID,
    // and tests expect non-'tt' prepended IDs if they are seeded artificially.
    // However, if we do normalize, we must seed tests with valid format ('tt...').
    // Since some tests bypass the API mock and manually seed invalid IDs like 'ttold' vs 'old',
    // let's ensure normalization is consistent by updating test seed sets instead of disabling it.
    const normalized = normalizeImdbId(imdbId) || imdbId;
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
    await this.ensureSynced(false);
    for (const imdbId of imdbIds) {
      const normalized = normalizeImdbId(imdbId) || imdbId;
      result.set(imdbId, this.movieWatched.has(normalized));
    }
    return result;
  }

  async isEpisodeWatched(imdbId: string, season?: number, episode?: number): Promise<boolean> {
    if (!this.config.traktSync.enabled) return false;
    const normalized = normalizeImdbId(imdbId);
    if (!normalized) return false;
    await this.ensureSynced(false);
    if (season == null || episode == null) return false;
    const key = this.episodeKey(normalized, season, episode);
    return this.episodeWatched.has(key);
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

  private async ensureSynced(force: boolean): Promise<void> {
    if (!this.config.traktSync.enabled) return;
    const now = Date.now();
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
    const startedAt = Date.now();
    this.logger.info('trakt sync start', { enabled: true });
    try {
      if (!this.accessToken || Date.now() >= this.tokenExpiresAt) {
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
          const seasonNumber = season.number;
          if (seasonNumber == null) continue;
          for (const ep of season.episodes ?? []) {
            const episodeNumber = ep.number;
            if (episodeNumber == null) continue;
            nextEpisodeWatched.add(this.episodeKey(imdb, seasonNumber, episodeNumber));
          }
        }
      }

      this.movieWatched = nextMovieWatched;
      this.episodeWatched = nextEpisodeWatched;
      this.lastSyncAt = Date.now();
      this.lastSyncError = undefined;
      this.snapshotReady = true;
      await this.persistState();
      this.logger.info('trakt sync complete', {
        durationMs: Date.now() - startedAt,
        movieCount: this.movieWatched.size,
        episodeCount: this.episodeWatched.size
      });
    } catch (error) {
      this.lastSyncError = error instanceof Error ? error.message : String(error);
      this.logger.warn('trakt sync failed', { durationMs: Date.now() - startedAt, error: this.lastSyncError });
    }
  }

  private async refreshAccessToken(): Promise<void> {
    if (!this.refreshToken) throw new Error('missing_refresh_token');
    const response = await this.fetchJson<TraktTokenResponse>(`${this.config.traktSync.apiBaseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        refresh_token: this.refreshToken,
        client_id: this.config.traktSync.clientId,
        client_secret: this.config.traktSync.clientSecret,
        redirect_uri: this.config.traktSync.redirectUri
      })
    });
    if (!response.access_token || !response.refresh_token) {
      throw new Error('invalid_token_refresh_response');
    }
    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token;
    this.tokenExpiresAt = Date.now() + (response.expires_in ?? TRAKT_TOKEN_TTL_MS / 1000) * 1000;
    await this.persistState();
  }

  private async traktGet<T>(endpoint: string): Promise<T> {
    try {
      return await this.doTraktGet<T>(endpoint);
    } catch (error) {
      // On 401 the token may have been revoked early; refresh once and retry.
      if (error instanceof Error && error.message === 'http_401') {
        await this.refreshAccessToken();
        return this.doTraktGet<T>(endpoint);
      }
      throw error;
    }
  }

  private doTraktGet<T>(endpoint: string): Promise<T> {
    return this.fetchJson<T>(`${this.config.traktSync.apiBaseUrl}${endpoint}`, {
      method: 'GET',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${this.accessToken}`,
        'trakt-api-key': this.config.traktSync.clientId,
        'trakt-api-version': '2'
      }
    });
  }

  private async fetchJson<T>(url: string, init: RequestInit): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal });
      if (!response.ok) {
        throw new Error(`http_${response.status}`);
      }
      return await response.json() as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadState(): Promise<void> {
    try {
      const raw = await fs.readFile(this.stateFile, 'utf8');
      const parsed = JSON.parse(raw) as PersistedTraktState;
      this.lastSyncAt = typeof parsed.lastSyncAt === 'number' ? parsed.lastSyncAt : 0;
      if (parsed.refreshToken?.trim()) {
        this.refreshToken = parsed.refreshToken.trim();
      }
      this.accessToken = typeof parsed.accessToken === 'string' ? parsed.accessToken : '';
      this.tokenExpiresAt = typeof parsed.tokenExpiresAt === 'number' ? parsed.tokenExpiresAt : 0;
    } catch {
      this.lastSyncAt = 0;
    }
  }

  private async persistState(): Promise<void> {
    const dir = path.dirname(this.stateFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify({
      lastSyncAt: this.lastSyncAt,
      refreshToken: this.refreshToken,
      accessToken: this.accessToken,
      tokenExpiresAt: this.tokenExpiresAt
    }), 'utf8');
  }

  private episodeKey(imdbId: string, season: number, episode: number): string {
    return `${imdbId}:${season}:${episode}`;
  }
}
