import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type {
  AddActionResult,
  ArrEpisodeStatus,
  SonarrEpisodeRecord,
  SonarrHistoryRecord,
  SonarrLookupRecord,
  SonarrQueueRecord,
  SonarrSeriesRecord
} from '../types.js';

export class SonarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly seriesCache: TtlCache<SonarrSeriesRecord[]>;
  private readonly episodeCache: TtlCache<SonarrEpisodeRecord[]>;
  private readonly queueCache: TtlCache<SonarrQueueRecord[]>;

  constructor(
    private readonly config: AppConfig,
    injectedHttp?: JsonHttpClient
  ) {
    this.logger = createLogger(config.logLevel);
    this.http =
      injectedHttp ??
      new JsonHttpClient({
        baseUrl: config.sonarr.baseUrl,
        apiKey: config.sonarr.apiKey,
        timeoutMs: config.requestTimeoutMs,
        logger: this.logger,
        serviceName: 'sonarr'
      });
    this.seriesCache = new TtlCache<SonarrSeriesRecord[]>(config.statusCacheTtlMs);
    this.episodeCache = new TtlCache<SonarrEpisodeRecord[]>(config.statusCacheTtlMs);
    this.queueCache = new TtlCache<SonarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
  }

  async getEpisodeStatus(imdbId: string, season?: number, episode?: number): Promise<ArrEpisodeStatus> {
    if (!this.config.sonarr.enabled) {
      return { state: 'unavailable', reason: 'Sonarr is disabled.' };
    }

    try {
      const series = await this.findSeriesByImdbId(imdbId);
      if (!series) {
        return { state: 'series_not_added' };
      }

      if (season == null || episode == null) {
        return { state: 'series_added', seriesId: series.id, monitored: !!series.monitored, title: series.title };
      }

      const episodes = await this.listEpisodes(series.id);
      const match = episodes.find(
        (item) => item.seasonNumber === season && item.episodeNumber === episode
      );

      if (!match) {
        return { state: 'series_added', seriesId: series.id, monitored: !!series.monitored, reason: 'Episode not found in Sonarr yet.', title: series.title };
      }

      if (match.hasFile || (match.episodeFileId ?? 0) > 0) {
        const rawFileName = match.episodeFile?.relativePath ?? match.episodeFile?.path;
        const fileName = rawFileName ? rawFileName.split(/[\\/]/).pop() : undefined;
        return {
          state: 'episode_downloaded',
          seriesId: series.id,
          episodeId: match.id,
          episodeFileId: match.episodeFileId,
          monitored: match.monitored,
          hasFile: true,
          title: series.title,
          fileName,
          fileSizeBytes: match.episodeFile?.size
        };
      }

      let isDownloading = false;
      try {
        isDownloading = await this.isEpisodeQueued(match.id, series.id);
      } catch {
        isDownloading = false;
      }
      if (isDownloading) {
        return { state: 'episode_downloading', seriesId: series.id, episodeId: match.id, monitored: match.monitored, hasFile: false, title: series.title };
      }
      if (match.monitored) {
        return { state: 'episode_missing', seriesId: series.id, episodeId: match.id, monitored: true, hasFile: false, title: series.title };
      }
      return { state: 'series_added', seriesId: series.id, monitored: !!series.monitored, hasFile: false, title: series.title };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'Unknown Sonarr error.'
      };
    }
  }

  async addSeriesByImdbId(imdbId: string): Promise<AddActionResult> {
    if (!this.config.sonarr.enabled) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr unavailable',
        summary: 'Sonarr is not enabled in this add-on.',
        detail: 'Set SONARR_ENABLED=true and provide base URL + API key.'
      };
    }

    this.logger.info('sonarr add start', { imdbId });
    const current = await this.findSeriesByImdbId(imdbId);
    if (current) {
      this.logger.info('sonarr add skipped', { imdbId, reason: 'already_exists', title: current.title });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Already in Sonarr',
        summary: 'Series is already added to Sonarr.',
        detail: current.title,
        alreadyExisted: true
      };
    }

    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) {
      this.logger.warn('sonarr add failed', { imdbId, reason: 'lookup_failed', title: undefined });
      return {
        ok: false,
        service: 'sonarr',
        title: 'Series lookup failed',
        summary: 'Could not resolve the series in Sonarr lookup.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    if (!lookup.tvdbId) {
      this.logger.warn('sonarr add failed', { imdbId, reason: 'no_tvdb_id', title: lookup.title });
      return {
        ok: false,
        service: 'sonarr',
        title: 'Series lookup failed',
        summary: 'Sonarr requires a TVDB ID but none was returned.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    const payload = {
      title: lookup.title,
      year: lookup.year,
      imdbId: lookup.imdbId,
      tvdbId: lookup.tvdbId,
      qualityProfileId: this.config.sonarr.qualityProfileId,
      languageProfileId: this.config.sonarr.languageProfileId,
      rootFolderPath: this.config.sonarr.rootFolderPath,
      monitored: true,
      tags: this.config.sonarr.tags,
      addOptions: {
        monitor: this.config.sonarr.seriesMonitor,
        searchForMissingEpisodes: this.config.sonarr.searchOnAdd,
        searchForCutoffUnmetEpisodes: false
      }
    };

    try {
      await this.http.post('/api/v3/series', payload);
    } catch (error) {
      if (
        error instanceof HttpError &&
        error.status === 400 &&
        /already been added/i.test(error.body)
      ) {
        this.seriesCache.clear();
        this.episodeCache.clear();
        this.logger.info('sonarr add skipped', { imdbId, reason: 'already_exists_400', title: lookup.title });
        return {
          ok: true,
          service: 'sonarr',
          title: 'Already in Sonarr',
          summary: 'Series is already added to Sonarr.',
          alreadyExisted: true
        };
      }
      throw error;
    }
    this.seriesCache.clear();
    this.episodeCache.clear();

    this.logger.info('sonarr add success', { imdbId, title: lookup.title, searchOnAdd: this.config.sonarr.searchOnAdd });
    return {
      ok: true,
      service: 'sonarr',
      title: 'Added to Sonarr',
      summary: this.config.sonarr.searchOnAdd ? 'Series added and search triggered.' : 'Series added.',
      detail: lookup.title
    };
  }

  async triggerEpisodeSearch(imdbId: string, season?: number, episode?: number): Promise<AddActionResult> {
    this.logger.info('sonarr search start', { imdbId, season, episode });
    const status = await this.getEpisodeStatus(imdbId, season, episode);
    if (status.state === 'unavailable') {
      this.logger.warn('sonarr search failed', { imdbId, reason: 'unavailable' });
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr unavailable',
        summary: status.reason ?? 'Sonarr status check failed.'
      };
    }
    if (status.state === 'series_not_added') {
      this.logger.warn('sonarr search failed', { imdbId, reason: 'not_added' });
      return {
        ok: false,
        service: 'sonarr',
        title: 'Not in Sonarr',
        summary: 'Series is not added yet.'
      };
    }
    if (status.state === 'episode_downloaded') {
      this.logger.info('sonarr search skipped', { imdbId, reason: 'already_downloaded' });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Already downloaded',
        summary: 'Episode file already exists.',
        alreadyExisted: true
      };
    }

    if (status.episodeId) {
      await this.http.post('/api/v3/command', {
        name: 'EpisodeSearch',
        episodeIds: [status.episodeId]
      });
      this.seriesCache.clear();
      this.episodeCache.clear();
      this.logger.info('sonarr search queued', { imdbId, episodeId: status.episodeId });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Search triggered',
        summary: 'Sonarr episode search queued.'
      };
    }

    if (status.seriesId) {
      await this.http.post('/api/v3/command', {
        name: 'MissingEpisodeSearch',
        seriesId: status.seriesId
      });
      this.seriesCache.clear();
      this.episodeCache.clear();
      this.logger.info('sonarr search queued', { imdbId, seriesId: status.seriesId, type: 'missing_episode' });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Search triggered',
        summary: 'Sonarr missing-episode search queued.'
      };
    }

    this.logger.warn('sonarr search failed', { imdbId, reason: 'no_ids' });
    return {
      ok: false,
      service: 'sonarr',
      title: 'Search skipped',
      summary: 'Could not resolve Sonarr ids for search.'
    };
  }

  invalidateCache(): void {
    this.seriesCache.clear();
    this.episodeCache.clear();
    this.queueCache.clear();
  }

  async getEpisodeFilePath(episodeFileId: number): Promise<string | null> {
    try {
      const record = await this.http.get<{ path?: string }>(`/api/v3/episodefile/${episodeFileId}`);
      return record.path ?? null;
    } catch {
      return null;
    }
  }

  private async isEpisodeQueued(episodeId: number, seriesId: number): Promise<boolean> {
    const records = await this.listQueueRecords();
    return records.some((item) => item.episodeId === episodeId || (item.seriesId === seriesId && item.episodeId == null));
  }

  private async listQueueRecords(): Promise<SonarrQueueRecord[]> {
    const cached = this.queueCache.get('records');
    if (cached) {
      return cached;
    }

    const results: SonarrQueueRecord[] = [];
    const pageSize = 250;
    for (let page = 1; page <= 20; page++) {
      const response = await this.http.get<
        { records?: SonarrQueueRecord[]; totalRecords?: number }
        | SonarrQueueRecord[]
      >(`/api/v3/queue?page=${page}&pageSize=${pageSize}&includeUnknownSeriesItems=true`);
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

  async listSeries(): Promise<SonarrSeriesRecord[]> {
    const cached = this.seriesCache.get('all');
    if (cached) return cached;
    const series = await this.http.get<SonarrSeriesRecord[]>('/api/v3/series');
    this.seriesCache.set('all', series);
    return series;
  }

  private async listEpisodes(seriesId: number): Promise<SonarrEpisodeRecord[]> {
    const key = `episodes:${seriesId}`;
    const cached = this.episodeCache.get(key);
    if (cached) return cached;
    const episodes = await this.http.get<SonarrEpisodeRecord[]>(
      `/api/v3/episode?seriesId=${seriesId}`
    );
    this.episodeCache.set(key, episodes);
    return episodes;
  }

  async listRecentSeriesImports(limit: number, offset = 0): Promise<SonarrHistoryRecord[]> {
    if (!this.config.sonarr.enabled) return [];
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const pageSize = Math.min(250, Math.max(50, Math.min(250, safeLimit)));
    const startPage = Math.floor(safeOffset / pageSize) + 1;
    const inPageOffset = safeOffset % pageSize;
    const collected: SonarrHistoryRecord[] = [];
    try {
      for (let page = startPage; page < startPage + 20 && collected.length < safeLimit; page++) {
        const response = await this.http.get<{ records?: SonarrHistoryRecord[] } | SonarrHistoryRecord[]>(
          `/api/v3/history?page=${page}&pageSize=${pageSize}&sortKey=date&sortDirection=descending`
        );
        const records = (Array.isArray(response) ? response : (response.records ?? []))
          .filter((item) => item?.seriesId != null)
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

  async listSeriesQueueDetails(): Promise<SonarrQueueRecord[]> {
    if (!this.config.sonarr.enabled) return [];
    const cached = this.queueCache.get('details');
    if (cached) return cached;

    const detailsPath = '/api/v3/queue/details?page=1&pageSize=250&includeUnknownSeriesItems=true';
    let records: SonarrQueueRecord[] = [];

    try {
      const details = await this.http.get<{ records?: SonarrQueueRecord[] } | SonarrQueueRecord[]>(detailsPath);
      records = Array.isArray(details) ? details : (details.records ?? []);
    } catch {
      records = await this.listQueueRecords();
    }

    this.queueCache.set('details', records);
    return records;
  }

  private async findSeriesByImdbId(imdbId: string): Promise<SonarrSeriesRecord | undefined> {
    const series = await this.listSeries();
    const inLibrary = series.find((item) => item.imdbId === imdbId);
    if (inLibrary) return inLibrary;

    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) return undefined;

    if (lookup.tvdbId != null) {
      return series.find((item) => item.tvdbId === lookup.tvdbId);
    }
    if (lookup.title) {
      return series.find((item) => item.title.toLowerCase() === lookup.title.toLowerCase());
    }
    return undefined;
  }

  private async lookupSeries(imdbId: string): Promise<SonarrLookupRecord | null> {
    const results = await this.http.get<SonarrLookupRecord[]>(
      `/api/v3/series/lookup?term=${encodeURIComponent(`imdb:${imdbId}`)}`
    );
    return results.find((item) => item.imdbId === imdbId) ?? results[0] ?? null;
  }

  async ping(): Promise<{ reachable: boolean; detail?: string }> {
    if (!this.config.sonarr.enabled) {
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
