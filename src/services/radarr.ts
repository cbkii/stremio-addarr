import type { AppConfig } from '../config.js';
import { AsyncTtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type { TmdbLookup } from './tmdb.js';
import type {
  AddActionResult,
  ArrCommandResponse,
  ArrMovieStatus,
  ArrQualityProfile,
  RadarrHistoryRecord,
  RadarrLookupRecord,
  RadarrMovieRecord,
  RadarrQueueRecord
} from '../types.js';

interface MoviesSnapshot {
  movies: RadarrMovieRecord[];
  byImdbId: Map<string, RadarrMovieRecord>;
  byTmdbId: Map<number, RadarrMovieRecord>;
}

export class RadarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly moviesSnapshotCache: AsyncTtlCache<MoviesSnapshot>;
  private readonly queueCache: AsyncTtlCache<RadarrQueueRecord[]>;
  private readonly qualityProfileCache: AsyncTtlCache<ArrQualityProfile[]>;

  constructor(
    private readonly config: AppConfig,
    injectedHttp?: JsonHttpClient,
    private readonly tmdbLookup?: TmdbLookup
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
    this.moviesSnapshotCache = new AsyncTtlCache<MoviesSnapshot>(config.statusCacheTtlMs);
    this.queueCache = new AsyncTtlCache<RadarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
    this.qualityProfileCache = new AsyncTtlCache<ArrQualityProfile[]>(Math.max(config.statusCacheTtlMs, 60_000));
  }

  private async getMoviesSnapshot(): Promise<MoviesSnapshot> {
    return this.moviesSnapshotCache.getOrSet('snapshot', async () => {
      const movies = await this.http.get<RadarrMovieRecord[]>('/api/v3/movie');
      const byImdbId = new Map<string, RadarrMovieRecord>();
      const byTmdbId = new Map<number, RadarrMovieRecord>();
      for (const movie of movies) {
        if (movie.imdbId) byImdbId.set(movie.imdbId.toLowerCase(), movie);
        if (movie.tmdbId != null) byTmdbId.set(movie.tmdbId, movie);
      }
      return { movies, byImdbId, byTmdbId };
    });
  }

  private async findMovieByImdbId(imdbId: string, fresh = false): Promise<RadarrMovieRecord | undefined> {
    if (fresh) this.moviesSnapshotCache.clear();
    const snapshot = await this.getMoviesSnapshot();
    const direct = snapshot.byImdbId.get(imdbId.toLowerCase());
    if (direct) return direct;
    if (this.tmdbLookup) {
      try {
        const tmdbId = await this.tmdbLookup.getMovieTmdbId(imdbId);
        if (tmdbId != null) return snapshot.byTmdbId.get(tmdbId);
      } catch {
        // Safe fallback: an unavailable optional mapper must not break status.
      }
    }
    return undefined;
  }

  private async qualityProfileName(profileId?: number): Promise<string | undefined> {
    if (profileId == null) return undefined;
    try {
      const profiles = await this.qualityProfileCache.getOrSet('profiles', () =>
        this.http.get<ArrQualityProfile[]>('/api/v3/qualityprofile')
      );
      return profiles.find((profile) => profile.id === profileId)?.name ?? `Profile ${profileId}`;
    } catch {
      return `Profile ${profileId}`;
    }
  }

  async getMovieStatus(imdbId: string): Promise<ArrMovieStatus> {
    if (!this.config.radarr.enabled) {
      return { state: 'unavailable', reason: 'Radarr is disabled.' };
    }

    try {
      const existing = await this.findMovieByImdbId(imdbId);
      if (!existing) return { state: 'not_added' };

      const qualityProfileName = await this.qualityProfileName(existing.qualityProfileId);
      const common = {
        movieId: existing.id,
        monitored: existing.monitored,
        title: existing.title,
        year: existing.year,
        qualityProfileId: existing.qualityProfileId,
        qualityProfileName,
        existingItemPolicy: this.config.radarr.existingItemPolicy
      };
      const releaseDate = this.pickMovieReleaseDate(existing.physicalRelease, existing.digitalRelease, existing.inCinemas);
      if (existing.hasFile || existing.movieFile) {
        const rawFileName = existing.movieFile?.relativePath ?? existing.movieFile?.path;
        const fileName = rawFileName ? rawFileName.split(/[\/]/).pop() : undefined;
        return {
          state: 'downloaded',
          ...common,
          movieFileId: existing.movieFile?.id,
          hasFile: true,
          releaseDate,
          fileName,
          fileSizeBytes: existing.movieFile?.size
        };
      }

      let isDownloading = false;
      try { isDownloading = await this.isMovieQueued(existing.id); } catch { isDownloading = false; }
      if (isDownloading) return { state: 'downloading', ...common, hasFile: false, releaseDate };
      if (existing.monitored) return { state: 'missing', ...common, monitored: true, hasFile: false, releaseDate };
      return { state: 'added', ...common, monitored: false, hasFile: false, releaseDate };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'Unknown Radarr error.'
      };
    }
  }

  private pickMovieReleaseDate(physicalRelease?: string, digitalRelease?: string, inCinemas?: string): string | undefined {
    const release = this.pickEarliestDate(physicalRelease, digitalRelease);
    return release ?? this.pickEarliestDate(inCinemas);
  }

  private pickEarliestDate(...values: Array<string | undefined>): string | undefined {
    const parsed = values
      .filter((value): value is string => Boolean(value))
      .map((value) => ({ value, ms: Date.parse(value) }))
      .filter((value) => Number.isFinite(value.ms))
      .sort((a, b) => a.ms - b.ms);
    return parsed[0]?.value;
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
    const existing = await this.findMovieByImdbId(imdbId, true);
    if (existing) {
      const profile = await this.qualityProfileName(existing.qualityProfileId);
      this.logger.info('radarr add skipped', { imdbId, reason: 'already_exists', movieId: existing.id });
      return {
        ok: true,
        service: 'radarr',
        title: 'Already in Radarr',
        summary: existing.hasFile || existing.movieFile ? 'Movie is already downloaded.' : 'Movie is already added.',
        detail: `${existing.title}${profile ? ` · ${profile}` : ''}`,
        alreadyExisted: true,
        itemId: existing.id
      };
    }

    const candidates = await this.lookupMovie(imdbId);
    let match = candidates.find((entry) => entry.imdbId?.toLowerCase() === imdbId.toLowerCase());
    let matchMethod = match ? 'imdb' : 'none';

    if (!match && this.tmdbLookup) {
      const expectedTmdbId = await this.tmdbLookup.getMovieTmdbId(imdbId);
      if (expectedTmdbId != null) {
        const tmdbMatch = candidates.find((entry) => entry.tmdbId === expectedTmdbId);
        if (tmdbMatch) {
          match = tmdbMatch;
          matchMethod = 'tmdb';
        }
      }
    }

    if (!match && !this.config.radarr.strictImdbMatch) {
      const expected = await this.fetchStremioCinemetaMovie(imdbId);
      const hasExpectedYear = expected?.year != null && Number.isFinite(expected.year);
      if (expected?.title && hasExpectedYear) {
        const normExpTitle = this.normalizeTitle(expected.title);
        const titleMatch = candidates.find((entry) =>
          entry.year === expected.year && this.normalizeTitle(entry.title) === normExpTitle
        );
        if (titleMatch) {
          match = titleMatch;
          matchMethod = 'title_year';
        }
      }
    }

    if (!match) {
      this.logger.warn('radarr add failed', { imdbId, reason: 'lookup_mismatch', candidatesCount: candidates.length });
      return {
        ok: false,
        service: 'radarr',
        title: 'Movie lookup mismatch',
        summary: 'Refused to add possible wrong movie.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    if (!match.tmdbId) {
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
      title: match.title,
      tmdbId: match.tmdbId,
      imdbId: match.imdbId,
      year: match.year,
      monitored: true,
      qualityProfileId: this.config.radarr.qualityProfileId,
      rootFolderPath: this.config.radarr.rootFolderPath,
      minimumAvailability: this.config.radarr.minimumAvailability,
      tags: this.config.radarr.tags,
      addOptions: {
        searchForMovie: false
      }
    };

    let created: RadarrMovieRecord;
    try {
      created = await this.http.post<RadarrMovieRecord>('/api/v3/movie', payload);
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 400 &&
        /already been added/i.test(error.body)
      ) {
        this.invalidateCache();
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
    this.invalidateCache();

    this.logger.info('radarr add success', {
      imdbId,
      title: match.title,
      year: match.year,
      tmdbId: match.tmdbId,
      matchMethod,
      searchOnAdd: false
    });

    return {
      ok: true,
      service: 'radarr',
      title: 'Added to Radarr',
      summary: 'Movie added.',
      detail: match.title,
      itemId: created?.id
    };
  }

  async triggerMovieSearch(
    imdbId: string,
    options: { existingBeforeAction?: boolean; knownMovieId?: number; knownTitle?: string } = { existingBeforeAction: true }
  ): Promise<AddActionResult> {
    this.logger.info('radarr search start', { imdbId });
    let existing: RadarrMovieRecord | undefined = options.knownMovieId != null
      ? { id: options.knownMovieId, imdbId, title: options.knownTitle ?? imdbId }
      : undefined;
    try {
      existing ??= await this.findMovieByImdbId(imdbId, true);
    } catch (error) {
      return {
        ok: false,
        service: 'radarr',
        title: 'Radarr unavailable',
        summary: error instanceof Error ? error.message : 'Radarr lookup failed.'
      };
    }
    if (!existing) {
      return { ok: false, service: 'radarr', title: 'Not in Radarr', summary: 'Movie is not added yet.' };
    }
    if (existing.hasFile || existing.movieFile) {
      return {
        ok: true,
        service: 'radarr',
        title: 'Already downloaded',
        summary: 'Movie file already exists.',
        detail: existing.title,
        alreadyExisted: true
      };
    }

    const policyDetail = options.existingBeforeAction === false
      ? 'Configured settings applied to the new movie.'
      : await this.applyExistingMoviePolicy(existing);

    const command = await this.http.post<ArrCommandResponse>('/api/v3/command', {
      name: 'MoviesSearch',
      movieIds: [existing.id]
    });
    const commandName = command?.name?.trim().toLowerCase();
    if (!Number.isInteger(command?.id) || Number(command.id) <= 0 || (commandName != null && commandName !== 'moviessearch')) {
      return {
        ok: false,
        service: 'radarr',
        title: 'Search was not accepted',
        summary: 'Radarr did not return a valid targeted MoviesSearch acknowledgement.',
        detail: existing.title
      };
    }

    this.invalidateCache();
    this.logger.info('radarr search queued', { imdbId, movieId: existing.id, commandId: command.id });
    return {
      ok: true,
      service: 'radarr',
      title: 'Movie search queued',
      summary: `Targeted search queued for ${existing.title}.`,
      detail: policyDetail,
      commandId: command.id
    };
  }

  private async applyExistingMoviePolicy(existing: RadarrMovieRecord): Promise<string> {
    const policy = this.config.radarr.existingItemPolicy;
    if (policy === 'preserve') return 'Existing profile and monitoring settings were preserved.';

    if (policy === 'extend') {
      if (existing.monitored === false) {
        await this.http.put('/api/v3/movie/editor', { movieIds: [existing.id], monitored: true });
        return 'Existing profile was preserved; movie monitoring was enabled.';
      }
      return 'Existing profile and monitoring settings were preserved.';
    }

    await this.http.put('/api/v3/movie/editor', {
      movieIds: [existing.id],
      monitored: true,
      qualityProfileId: this.config.radarr.qualityProfileId,
      minimumAvailability: this.config.radarr.minimumAvailability,
      rootFolderPath: this.config.radarr.rootFolderPath,
      tags: this.config.radarr.tags,
      applyTags: 'replace',
      moveFiles: false
    });
    return `Configured Radarr settings were applied (Profile ${this.config.radarr.qualityProfileId}).`;
  }

  invalidateCache(): void {
    this.moviesSnapshotCache.clear();
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
    return this.queueCache.getOrSet('records', async () => {
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
      return results;
    });
  }

  async listMovies(): Promise<RadarrMovieRecord[]> {
    const snapshot = await this.getMoviesSnapshot();
    return snapshot.movies;
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
    return this.queueCache.getOrSet('details', async () => {
      const detailsPath = '/api/v3/queue/details?page=1&pageSize=250&includeUnknownMovieItems=true';
      let records: RadarrQueueRecord[] = [];

      try {
        const details = await this.http.get<{ records?: RadarrQueueRecord[] } | RadarrQueueRecord[]>(detailsPath);
        records = Array.isArray(details) ? details : (details.records ?? []);
      } catch {
        records = await this.listQueueRecords();
      }

      return records;
    });
  }

  private async fetchStremioCinemetaMovie(imdbId: string): Promise<{ title: string; year?: number } | undefined> {
    if (typeof globalThis.fetch !== 'function') {
      return undefined;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.requestTimeoutMs);

    try {
      const response = await globalThis.fetch(`https://v3-cinemeta.strem.io/meta/movie/${encodeURIComponent(imdbId)}.json`, {
        signal: controller.signal
      });
      if (!response.ok) return undefined;
      const data = await response.json();
      const meta = data?.meta;
      if (meta?.name) {
        const parsedYear = meta.year ? parseInt(String(meta.year), 10) : undefined;
        const year = Number.isFinite(parsedYear) ? parsedYear : undefined;
        return {
          title: meta.name,
          year
        };
      }
    } catch {
      return undefined;
    } finally {
      clearTimeout(timeout);
    }
    return undefined;
  }

  private normalizeTitle(title?: string): string {
    if (!title) return '';
    return title
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '');
  }

  private async lookupMovie(imdbId: string): Promise<RadarrLookupRecord[]> {
    const response = await this.http.get<RadarrLookupRecord | RadarrLookupRecord[]>(
      `/api/v3/movie/lookup/imdb?imdbId=${encodeURIComponent(imdbId)}`
    );
    return Array.isArray(response) ? response : (response ? [response] : []);
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
