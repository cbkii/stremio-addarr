import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type {
  AddActionResult,
  ArrMovieStatus,
  RadarrHistoryRecord,
  RadarrLookupRecord,
  RadarrMovieRecord,
  RadarrReleaseRecord,
  RadarrQueueRecord
} from '../types.js';

export class RadarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly moviesCache: TtlCache<RadarrMovieRecord[]>;
  private readonly queueCache: TtlCache<RadarrQueueRecord[]>;

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
    this.queueCache = new TtlCache<RadarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
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
        const rawFileName = existing.movieFile?.relativePath ?? existing.movieFile?.path;
        const fileName = rawFileName ? rawFileName.split(/[\\/]/).pop() : undefined;
        return {
          state: 'downloaded',
          movieId: existing.id,
          movieFileId: existing.movieFile?.id,
          monitored: existing.monitored,
          hasFile: true,
          title: existing.title,
          year: existing.year,
          fileName,
          fileSizeBytes: existing.movieFile?.size
        };
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
        this.logger.info('radarr add skipped', { imdbId, reason: 'already_exists_400', state: 'unknown' });
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

    if (status.monitored === false) {
      await this.http.put('/api/v3/movie/editor', { movieIds: [status.movieId], monitored: true });
    }

    const grabbed = await this.tryGrabTopRelease(status.movieId);
    if (!grabbed) {
      await this.http.post('/api/v3/command', {
        name: 'MoviesSearch',
        movieIds: [status.movieId]
      });
    }
    this.moviesCache.clear();
    this.logger.info('radarr search queued', { imdbId, movieId: status.movieId, method: grabbed ? 'release_grab' : 'command_search' });
    return {
      ok: true,
      service: 'radarr',
      title: 'Search triggered',
      summary: grabbed ? 'Radarr release grabbed for download.' : 'Radarr movie search queued.'
    };
  }

  private async tryGrabTopRelease(movieId: number): Promise<boolean> {
    try {
      const releases = await this.http.get<RadarrReleaseRecord[]>(`/api/v3/release?movieId=${movieId}`);
      const candidate = releases
        .filter((item) => item.approved && !item.rejected && item.downloadAllowed !== false && item.guid && item.indexerId != null)
        .sort((a, b) => (b.releaseWeight ?? Number.NEGATIVE_INFINITY) - (a.releaseWeight ?? Number.NEGATIVE_INFINITY))[0];
      if (!candidate?.guid || candidate.indexerId == null) {
        return false;
      }
      await this.http.post('/api/v3/release', {
        guid: candidate.guid,
        indexerId: candidate.indexerId,
        movieId,
        ...(candidate.downloadClientId != null ? { downloadClientId: candidate.downloadClientId } : {})
      });
      return true;
    } catch {
      return false;
    }
  }

  invalidateCache(): void {
    this.moviesCache.clear();
    this.queueCache.clear();
  }

  async getMovieFilePath(movieFileId: number): Promise<string | null> {
    try {
      const record = await this.http.get<{ path?: string }>(`/api/v3/moviefile/${movieFileId}`);
      return record.path ?? null;
    } catch {
      return null;
    }
  }

  private async isMovieQueued(movieId: number): Promise<boolean> {
    const records = await this.listQueueRecords();
    return records.some((item) => item.movieId === movieId);
  }

  private async listQueueRecords(): Promise<RadarrQueueRecord[]> {
    const cached = this.queueCache.get('records');
    if (cached) {
      return cached;
    }

    const results: RadarrQueueRecord[] = [];
    const pageSize = 250;
    for (let page = 1; page <= 20; page++) {
      const response = await this.http.get<{ records?: RadarrQueueRecord[]; totalRecords?: number } | RadarrQueueRecord[]>(
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

  async listMovies(): Promise<RadarrMovieRecord[]> {
    const cached = this.moviesCache.get('all');
    if (cached) return cached;
    const movies = await this.http.get<RadarrMovieRecord[]>('/api/v3/movie');
    this.moviesCache.set('all', movies);
    return movies;
  }



  async listRecentMovieImports(limit: number, offset = 0): Promise<RadarrHistoryRecord[]> {
    if (!this.config.radarr.enabled) return [];
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const pageSize = Math.min(250, Math.max(50, Math.min(250, safeLimit)));
    const startPage = Math.floor(safeOffset / pageSize) + 1;
    const inPageOffset = safeOffset % pageSize;
    const collected: RadarrHistoryRecord[] = [];
    try {
      for (let page = startPage; page < startPage + 20 && collected.length < safeLimit; page++) {
        const response = await this.http.get<{ records?: RadarrHistoryRecord[] } | RadarrHistoryRecord[]>(
          `/api/v3/history?page=${page}&pageSize=${pageSize}&sortKey=date&sortDirection=descending`
        );
        const records = (Array.isArray(response) ? response : (response.records ?? []))
          .filter((item) => item?.movieId != null)
          .filter((item) => {
            const eventType = `${item?.eventType ?? ''}`.toLowerCase();
            return !eventType || eventType.includes('import');
          });
        const pageRecords = page === startPage ? records.slice(inPageOffset) : records;
        collected.push(...pageRecords);
        if (records.length < pageSize) {
          break;
        }
      }
      return collected.slice(0, safeLimit);
    } catch {
      return [];
    }
  }

  async listMovieQueueDetails(): Promise<RadarrQueueRecord[]> {
    if (!this.config.radarr.enabled) return [];
    const cached = this.queueCache.get('details');
    if (cached) return cached;

    const detailsPath = '/api/v3/queue/details?page=1&pageSize=250&includeUnknownMovieItems=true';
    let records: RadarrQueueRecord[] = [];

    try {
      const details = await this.http.get<{ records?: RadarrQueueRecord[] } | RadarrQueueRecord[]>(detailsPath);
      records = Array.isArray(details) ? details : (details.records ?? []);
    } catch {
      records = await this.listQueueRecords();
    }

    this.queueCache.set('details', records);
    return records;
  }

  private async lookupMovie(imdbId: string): Promise<RadarrLookupRecord | null> {
    // Radarr /movie/lookup/imdb returns a single RadarrLookupRecord (not an array).
    // Fallback: if the response is unexpectedly an array (older Radarr builds), handle both.
    const response = await this.http.get<RadarrLookupRecord | RadarrLookupRecord[]>(
      `/api/v3/movie/lookup/imdb?imdbId=${encodeURIComponent(imdbId)}`
    );
    if (Array.isArray(response)) {
      return response.find((entry) => entry.imdbId === imdbId) ?? response[0] ?? null;
    }
    return response ?? null;
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
