import fs from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from '../logger.js';
import { TtlCache } from '../lib/cache.js';
import type { AppConfig } from '../config.js';
import type { WatchedLookup, WatchedLookupDiagnostics } from './watched.js';

interface TraktTokenResponse {
  access_token?: string;
  refresh_token?: string;
}

interface PersistedTraktState {
  lastSyncAt?: number;
  refreshToken?: string;
}

interface TraktWatchedMovie {
  movie?: { ids?: { imdb?: string } };
}

interface TraktWatchedShow {
  show?: { ids?: { imdb?: string } };
  seasons?: Array<{ number?: number; episodes?: Array<{ number?: number }> }>;
}

export class TraktWatchedLookup implements WatchedLookup {
  private readonly syncMs: number;
  private readonly stateFile: string;
  private readonly movieWatched = new Set<string>();
  private readonly episodeWatched = new Set<string>();
  private readonly lookupCache = new TtlCache<boolean>(60_000);
  private accessToken = '';
  private refreshToken: string;
  private lastSyncAt = 0;
  private lastSyncError?: string;
  private runningSync: Promise<void> | null = null;

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
    await this.ensureSynced(false);
    const cacheKey = `movie:${imdbId}`;
    const cached = this.lookupCache.get(cacheKey);
    if (cached != null) return cached;
    const watched = this.movieWatched.has(imdbId);
    this.lookupCache.set(cacheKey, watched);
    return watched;
  }

  async isEpisodeWatched(imdbId: string, season?: number, episode?: number): Promise<boolean> {
    if (!this.config.traktSync.enabled) return false;
    await this.ensureSynced(false);
    if (season == null || episode == null) return false;
    const key = this.episodeKey(imdbId, season, episode);
    const cacheKey = `episode:${key}`;
    const cached = this.lookupCache.get(cacheKey);
    if (cached != null) return cached;
    const watched = this.episodeWatched.has(key);
    this.lookupCache.set(cacheKey, watched);
    return watched;
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
    if (!force && this.lastSyncAt > 0 && (now - this.lastSyncAt) < this.syncMs) return;
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
      await this.refreshAccessToken();
      const [movies, shows] = await Promise.all([
        this.traktGet<TraktWatchedMovie[]>('/sync/watched/movies'),
        this.traktGet<TraktWatchedShow[]>('/sync/watched/shows')
      ]);
      this.movieWatched.clear();
      this.episodeWatched.clear();
      for (const item of movies) {
        const imdb = item.movie?.ids?.imdb?.trim();
        if (imdb) this.movieWatched.add(imdb);
      }
      for (const item of shows) {
        const imdb = item.show?.ids?.imdb?.trim();
        if (!imdb) continue;
        for (const season of item.seasons ?? []) {
          const seasonNumber = season.number;
          if (seasonNumber == null) continue;
          for (const ep of season.episodes ?? []) {
            const episodeNumber = ep.number;
            if (episodeNumber == null) continue;
            this.episodeWatched.add(this.episodeKey(imdb, seasonNumber, episodeNumber));
          }
        }
      }
      this.lastSyncAt = Date.now();
      this.lastSyncError = undefined;
      this.lookupCache.clear();
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
    await this.persistState();
  }

  private async traktGet<T>(endpoint: string): Promise<T> {
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
    } catch {
      this.lastSyncAt = 0;
    }
  }

  private async persistState(): Promise<void> {
    const dir = path.dirname(this.stateFile);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.stateFile, JSON.stringify({
      lastSyncAt: this.lastSyncAt,
      refreshToken: this.refreshToken
    }), 'utf8');
  }

  private episodeKey(imdbId: string, season: number, episode: number): string {
    return `${imdbId}:${season}:${episode}`;
  }
}
