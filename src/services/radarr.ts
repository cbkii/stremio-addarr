import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type { AddActionResult, ArrMovieStatus, RadarrLookupRecord, RadarrMovieRecord } from '../types.js';

export class RadarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly moviesCache: TtlCache<RadarrMovieRecord[]>;
  private readonly queueCache: TtlCache<Array<{ movieId?: number }>>;

  constructor(
    private readonly config: AppConfig,
    injectedHttp?: JsonHttpClient
  ) {
    this.logger = createLogger(config.logLevel);
    this.http =
      injectedHttp ??
      new JsonHttpClient({
        baseUrl: config.radarr.baseUrl,
        apiKey: config.radarr.apiKey,
        timeoutMs: config.requestTimeoutMs,
        logger: this.logger,
        serviceName: 'radarr'
      });
    this.moviesCache = new TtlCache<RadarrMovieRecord[]>(config.statusCacheTtlMs);
    this.queueCache = new TtlCache<Array<{ movieId?: number }>>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
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
        return { state: 'downloaded', movieId: existing.id, monitored: existing.monitored, hasFile: true, title: existing.title, year: existing.year };
      }

      let isDownloading = false;
      try {
        isDownloading = await this.isMovieQueued(existing.id);
      } catch {
        isDownloading = false;
      }
      if (isDownloading) {
        return { state: 'downloading', movieId: existing.id, monitored: existing.monitored, hasFile: false, title: existing.title, year: existing.year };
      }
      if (existing.monitored) {
        return { state: 'missing', movieId: existing.id, monitored: true, hasFile: false, title: existing.title, year: existing.year };
      }
      return { state: 'added', movieId: existing.id, monitored: false, hasFile: false, title: existing.title, year: existing.year };
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

    this.logger.info('radarr add start', { imdbId });
    const current = await this.getMovieStatus(imdbId);
    if (current.state === 'downloaded' || current.state === 'added' || current.state === 'missing' || current.state === 'downloading') {
      this.logger.info('radarr add skipped', { imdbId, reason: 'already_exists', state: current.state });
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
      this.logger.warn('radarr add failed', { imdbId, reason: 'lookup_failed' });
      return {
        ok: false,
        service: 'radarr',
        title: 'Movie lookup failed',
        summary: 'Could not resolve the movie in Radarr lookup.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    if (!lookup.tmdbId) {
      this.logger.warn('radarr add failed', { imdbId, reason: 'no_tmdb_id' });
      return {
        ok: false,
        service: 'radarr',
        title: 'Movie lookup failed',
        summary: 'Radarr requires a TMDB ID but none was returned.',
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

    try {
      await this.http.post('/api/v3/movie', payload);
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 400 &&
        /already been added/i.test(error.body)
      ) {
        this.moviesCache.clear();
        this.logger.info('radarr add skipped', { imdbId, reason: 'already_exists_400' });
        return {
          ok: true,
          service: 'radarr',
          title: 'Already in Radarr',
          summary: 'Movie is already added to Radarr.',
          alreadyExisted: true
        };
      }
      throw error;
    }
    this.moviesCache.clear();

    this.logger.info('radarr add success', { imdbId, title: lookup.title, searchOnAdd: this.config.radarr.searchOnAdd });
    return {
      ok: true,
      service: 'radarr',
      title: 'Added to Radarr',
      summary: this.config.radarr.searchOnAdd ? 'Movie added and search triggered.' : 'Movie added.',
      detail: lookup.title
    };
  }

  async triggerMovieSearch(imdbId: string): Promise<AddActionResult> {
    this.logger.info('radarr search start', { imdbId });
    const status = await this.getMovieStatus(imdbId);
    if (status.state === 'unavailable') {
      this.logger.warn('radarr search failed', { imdbId, reason: 'unavailable' });
      return {
        ok: false,
        service: 'radarr',
        title: 'Radarr unavailable',
        summary: status.reason ?? 'Radarr status check failed.'
      };
    }
    if (status.state === 'not_added') {
      this.logger.warn('radarr search failed', { imdbId, reason: 'not_added' });
      return {
        ok: false,
        service: 'radarr',
        title: 'Not in Radarr',
        summary: 'Movie is not added yet.'
      };
    }
    if (status.state === 'downloaded') {
      this.logger.info('radarr search skipped', { imdbId, reason: 'already_downloaded' });
      return {
        ok: true,
        service: 'radarr',
        title: 'Already downloaded',
        summary: 'Movie file already exists.',
        alreadyExisted: true
      };
    }
    if (!status.movieId) {
      this.logger.warn('radarr search failed', { imdbId, reason: 'no_movie_id' });
      return {
        ok: false,
        service: 'radarr',
        title: 'Search skipped',
        summary: 'Could not resolve Radarr movie id.'
      };
    }

    await this.http.post('/api/v3/command', {
      name: 'MoviesSearch',
      movieIds: [status.movieId]
    });
    this.moviesCache.clear();
    this.logger.info('radarr search queued', { imdbId, movieId: status.movieId });
    return {
      ok: true,
      service: 'radarr',
      title: 'Search triggered',
      summary: 'Radarr movie search queued.'
    };
  }

  invalidateCache(): void {
    this.moviesCache.clear();
    this.queueCache.clear();
  }

  private async isMovieQueued(movieId: number): Promise<boolean> {
    const records = await this.listQueueRecords();
    return records.some((item) => item.movieId === movieId);
  }

  private async listQueueRecords(): Promise<Array<{ movieId?: number }>> {
    const cached = this.queueCache.get('records');
    if (cached) {
      return cached;
    }

    const results: Array<{ movieId?: number }> = [];
    const pageSize = 250;
    for (let page = 1; page <= 20; page++) {
      const response = await this.http.get<{ records?: Array<{ movieId?: number }>; totalRecords?: number } | Array<{ movieId?: number }>>(
        `/api/v3/queue?page=${page}&pageSize=${pageSize}&includeUnknownMovieItems=true`
      );
      const records = Array.isArray(response) ? response : (response.records ?? []);
      results.push(...records);

      if (records.length === 0) {
        break;
      }
      if (!Array.isArray(response) && typeof response.totalRecords === 'number' && results.length >= response.totalRecords) {
        break;
      }

      if (records.length < pageSize && (Array.isArray(response) || typeof response.totalRecords !== 'number')) {
        break;
      }
    }

    this.queueCache.set('records', results);
    return results;
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
      if (error.status === 401 || error.status === 403) return 'auth_error';
      if (error.status === 404) return 'not_found';
      return `http_${error.status}`;
    }
    if (error instanceof TypeError && /fetch|network|ECONNREFUSED/i.test(error.message)) {
      return 'unreachable';
    }
    if (error instanceof Error) {
      return error.message;
    }
    return 'unknown_error';
  }
}
