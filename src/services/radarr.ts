import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import type { AddActionResult, ArrMovieStatus, RadarrLookupRecord, RadarrMovieRecord } from '../types.js';

export class RadarrClient {
  private readonly http: JsonHttpClient;
  private readonly moviesCache: TtlCache<RadarrMovieRecord[]>;

  constructor(
    private readonly config: AppConfig,
    injectedHttp?: JsonHttpClient
  ) {
    this.http =
      injectedHttp ??
      new JsonHttpClient({
        baseUrl: config.radarr.baseUrl,
        apiKey: config.radarr.apiKey,
        timeoutMs: config.requestTimeoutMs
      });
    this.moviesCache = new TtlCache<RadarrMovieRecord[]>(config.statusCacheTtlMs);
  }

  async getMovieStatus(imdbId: string): Promise<ArrMovieStatus> {
    if (!this.config.radarr.enabled) {
      return { state: 'unavailable', reason: 'Radarr is disabled.' };
    }

    try {
      const movies = await this.listMovies();
      const existing = movies.find((movie) => movie.imdbId === imdbId);
      if (!existing) {
        return { state: 'not_added' };
      }
      if (existing.hasFile || existing.movieFile) {
        return { state: 'downloaded', monitored: existing.monitored, hasFile: true };
      }
      if (existing.monitored) {
        return { state: 'missing', monitored: true, hasFile: false };
      }
      return { state: 'added', monitored: false, hasFile: false };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'Unknown Radarr error.'
      };
    }
  }

  async addMovieByImdbId(imdbId: string): Promise<AddActionResult> {
    if (!this.config.radarr.enabled) {
      return {
        ok: false,
        service: 'radarr',
        title: 'Radarr unavailable',
        summary: 'Radarr is not enabled in this add-on.',
        detail: 'Set RADARR_ENABLED=true and provide base URL + API key.'
      };
    }

    const current = await this.getMovieStatus(imdbId);
    if (current.state === 'downloaded' || current.state === 'added' || current.state === 'missing') {
      return {
        ok: true,
        service: 'radarr',
        title: 'Already in Radarr',
        summary: current.state === 'downloaded' ? 'Movie is already downloaded.' : 'Movie is already added.',
        alreadyExisted: true
      };
    }

    const lookup = await this.lookupMovie(imdbId);
    if (!lookup) {
      return {
        ok: false,
        service: 'radarr',
        title: 'Movie lookup failed',
        summary: 'Could not resolve the movie in Radarr lookup.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    const payload = {
      title: lookup.title,
      tmdbId: lookup.tmdbId,
      imdbId: lookup.imdbId,
      year: lookup.year,
      monitored: true,
      qualityProfileId: this.config.radarr.qualityProfileId,
      rootFolderPath: this.config.radarr.rootFolderPath,
      minimumAvailability: this.config.radarr.minimumAvailability,
      tags: this.config.radarr.tags,
      addOptions: {
        searchForMovie: this.config.radarr.searchOnAdd
      }
    };

    await this.http.post('/api/v3/movie', payload);
    this.moviesCache.clear();

    return {
      ok: true,
      service: 'radarr',
      title: 'Added to Radarr',
      summary: this.config.radarr.searchOnAdd ? 'Movie added and search triggered.' : 'Movie added.',
      detail: lookup.title
    };
  }

  private async listMovies(): Promise<RadarrMovieRecord[]> {
    const cached = this.moviesCache.get('all');
    if (cached) return cached;
    const movies = await this.http.get<RadarrMovieRecord[]>('/api/v3/movie');
    this.moviesCache.set('all', movies);
    return movies;
  }

  private async lookupMovie(imdbId: string): Promise<RadarrLookupRecord | null> {
    const records = await this.http.get<RadarrLookupRecord[]>(
      `/api/v3/movie/lookup/imdb?imdbId=${encodeURIComponent(imdbId)}`
    );
    return records.find((entry) => entry.imdbId === imdbId) ?? records[0] ?? null;
  }

  async ping(): Promise<{ reachable: boolean; detail?: string }> {
    if (!this.config.radarr.enabled) {
      return { reachable: false, detail: 'disabled' };
    }
    try {
      await this.http.get('/api/v3/system/status');
      return { reachable: true };
    } catch (error) {
      return { reachable: false, detail: this.mapError(error) };
    }
  }

  private mapError(error: unknown): string {
    if (error instanceof HttpTimeoutError) {
      return 'timeout';
    }
    if (error instanceof HttpError) {
      return `http_${error.status}`;
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'unknown_error';
  }
}
