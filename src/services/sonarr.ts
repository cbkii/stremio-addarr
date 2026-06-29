import type { AppConfig } from '../config.js';
import { AsyncTtlCache, TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type {
  AddActionResult,
  ArrEpisodeStatus,
  SonarrEpisodeRecord,
  SonarrHistoryRecord,
  SonarrLookupRecord,
  SonarrQueueRecord,
  SonarrReleaseRecord,
  SonarrSeriesRecord
} from '../types.js';

export class SonarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly seriesCache: AsyncTtlCache<SonarrSeriesRecord[]>;
  private readonly episodeCache: AsyncTtlCache<SonarrEpisodeRecord[]>;
  private readonly queueCache: AsyncTtlCache<SonarrQueueRecord[]>;
  private readonly seriesByImdbIdCache: AsyncTtlCache<Map<string, SonarrSeriesRecord>>;

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
    this.seriesCache = new AsyncTtlCache<SonarrSeriesRecord[]>(config.statusCacheTtlMs);
    this.episodeCache = new AsyncTtlCache<SonarrEpisodeRecord[]>(config.statusCacheTtlMs);
    this.queueCache = new AsyncTtlCache<SonarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
    this.seriesByImdbIdCache = new AsyncTtlCache<Map<string, SonarrSeriesRecord>>(config.statusCacheTtlMs);
  }

  private async getSeriesByImdbIdMap(): Promise<Map<string, SonarrSeriesRecord>> {
    return this.seriesByImdbIdCache.getOrSet('map', async () => {
      const seriesList = await this.listSeries();
      const map = new Map<string, SonarrSeriesRecord>();
      for (const series of seriesList) {
        if (series.imdbId) {
          map.set(series.imdbId, series);
        }
      }
      return map;
    });
  }

  private async sleep(ms: number): Promise<void> {
    await new Promise<void>((resolve) => setTimeout(resolve, ms));
  }

  private isEpisodeScopedMonitorMode(mode: AppConfig['sonarr']['seriesMonitor']): mode is 'ep' | 'epfuture' | 'epseason' {
    return mode === 'ep' || mode === 'epfuture' || mode === 'epseason';
  }

  private resolveMonitorNewItems(mode: 'ep' | 'epfuture' | 'epseason'): 'all' | 'none' {
    if (this.config.sonarr.monitorNewItems !== 'auto') {
      return this.config.sonarr.monitorNewItems;
    }
    return mode === 'epfuture' ? 'all' : 'none';
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
      const episodeReleaseDate = this.pickEpisodeReleaseDate(match?.airDateUtc, match?.airDate);

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
          episodeReleaseDate,
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
        return {
          state: 'episode_downloading',
          seriesId: series.id,
          episodeId: match.id,
          monitored: match.monitored,
          hasFile: false,
          title: series.title,
          episodeReleaseDate
        };
      }
      if (match.monitored) {
        return {
          state: 'episode_missing',
          seriesId: series.id,
          episodeId: match.id,
          monitored: true,
          hasFile: false,
          title: series.title,
          episodeReleaseDate
        };
      }
      return { state: 'series_added', seriesId: series.id, monitored: !!series.monitored, hasFile: false, title: series.title };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: error instanceof Error ? error.message : 'Unknown Sonarr error.'
      };
    }
  }

  private pickEpisodeReleaseDate(airDateUtc?: string, airDate?: string): string | undefined {
    // Prefer the broadcast date (date-only, TZ-neutral) so display is not shifted
    // by the viewer's timezone relative to the UTC air timestamp.
    if (airDate && Number.isFinite(Date.parse(airDate))) return airDate;
    if (airDateUtc && Number.isFinite(Date.parse(airDateUtc))) return airDateUtc;
    return undefined;
  }

  async addSeriesByImdbId(
    imdbId: string,
    opts?: { season?: number; episode?: number }
  ): Promise<AddActionResult> {
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

    const monitorMode = this.config.sonarr.seriesMonitor;
    const useEpisodeScopedMonitor = this.isEpisodeScopedMonitorMode(monitorMode) && opts?.season != null && opts.episode != null;
    const addMonitor = useEpisodeScopedMonitor
      ? 'none'
      : (this.isEpisodeScopedMonitorMode(monitorMode)
        ? (monitorMode === 'epfuture' ? 'future' : 'none')
        : monitorMode);
    const payload = {
      title: lookup.title,
      year: lookup.year,
      imdbId: lookup.imdbId,
      tvdbId: lookup.tvdbId,
      qualityProfileId: this.config.sonarr.qualityProfileId,
      ...(this.config.sonarr.languageProfileId != null ? { languageProfileId: this.config.sonarr.languageProfileId } : {}),
      rootFolderPath: this.config.sonarr.rootFolderPath,
      monitored: true,
      ...(!useEpisodeScopedMonitor
        ? {
          monitorNewItems: this.config.sonarr.monitorNewItems === 'auto'
            ? 'all'
            : this.config.sonarr.monitorNewItems
        }
        : {}),
      tags: this.config.sonarr.tags,
      addOptions: {
        monitor: addMonitor,
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
        this.invalidateCache();
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
    this.invalidateCache();

    if (useEpisodeScopedMonitor) {
      const applied = await this.applyEpisodeMonitoringFromReferencePoint(
        imdbId,
        opts!.season!,
        opts!.episode!,
        monitorMode
      );
      if (!applied.ok) {
        return applied.result;
      }
    }

    this.logger.info('sonarr add success', { imdbId, title: lookup.title, searchOnAdd: this.config.sonarr.searchOnAdd });
    return {
      ok: true,
      service: 'sonarr',
      title: 'Added to Sonarr',
      summary: this.config.sonarr.searchOnAdd ? 'Series added and search triggered.' : 'Series added.',
      detail: lookup.title
    };
  }

  private async applyEpisodeMonitoringFromReferencePoint(
    imdbId: string,
    season: number,
    episode: number,
    mode: 'ep' | 'epfuture' | 'epseason'
  ): Promise<{ ok: true } | { ok: false; result: AddActionResult }> {
    const startedAt = Date.now();
    let series: SonarrSeriesRecord | undefined;
    while (!series && (Date.now() - startedAt) < this.config.sonarr.episodeReadyTimeoutMs) {
      series = await this.findSeriesByImdbId(imdbId);
      if (!series) {
        await this.sleep(this.config.sonarr.episodeReadyPollMs);
      }
    }
    if (!series?.id) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'series_not_ready', mode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Sonarr processing delayed',
          summary: 'Series was added, but Sonarr metadata was not ready for episode monitor update in time.'
        }
      };
    }

    let episodes: SonarrEpisodeRecord[] = [];
    const episodeWaitStartedAt = Date.now();
    while ((Date.now() - episodeWaitStartedAt) < this.config.sonarr.episodeReadyTimeoutMs) {
      episodes = await this.listEpisodes(series.id);
      if (episodes.length > 0) break;
      this.episodeCache.clear();
      await this.sleep(this.config.sonarr.episodeReadyPollMs);
    }
    if (episodes.length === 0) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'episode_list_empty', mode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Sonarr processing delayed',
          summary: 'Series was added, but Sonarr episode list was not ready for monitor update in time.'
        }
      };
    }

    const ordered = episodes
      .filter((item) => item.seasonNumber > 0 && item.episodeNumber > 0 && item.id > 0)
      .sort((a, b) => {
        if (a.seasonNumber !== b.seasonNumber) return a.seasonNumber - b.seasonNumber;
        return a.episodeNumber - b.episodeNumber;
      });
    const pivot = ordered.find((item) => item.seasonNumber === season && item.episodeNumber === episode);
    if (!pivot) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'pivot_episode_missing', mode, season, episode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Episode not found',
          summary: `Series was added, but S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} is not in Sonarr episode metadata yet.`
        }
      };
    }

    const effectiveMode = this.resolveEffectiveEpisodeScopedMode(mode, ordered, pivot);
    const targetIds = effectiveMode === 'ep'
      ? [pivot.id]
      : ordered
        .filter((item) => {
          if (effectiveMode === 'epseason') {
            return item.seasonNumber === season && item.episodeNumber >= episode;
          }
          return item.seasonNumber > season || (item.seasonNumber === season && item.episodeNumber >= episode);
        })
        .map((item) => item.id);

    if (targetIds.length === 0) {
      this.logger.warn('sonarr episode monitor apply failed', { imdbId, reason: 'no_target_ids', mode, season, episode });
      return {
        ok: false,
        result: {
          ok: false,
          service: 'sonarr',
          title: 'Monitor update failed',
          summary: 'Series was added, but no Sonarr episode IDs were available for monitor update.'
        }
      };
    }

    const allIds = ordered.map((item) => item.id);
    if (allIds.length > 0) {
      await this.http.put('/api/v3/episode/monitor', { episodeIds: allIds, monitored: false });
    }
    await this.http.put('/api/v3/episode/monitor', { episodeIds: targetIds, monitored: true });
    await this.http.put('/api/v3/series/editor', {
      seriesIds: [series.id],
      monitored: true,
      monitorNewItems: this.resolveMonitorNewItems(effectiveMode)
    });
    this.invalidateCache();
    this.logger.info('sonarr episode monitor applied', {
      imdbId,
      seriesId: series.id,
      mode: effectiveMode,
      season,
      episode,
      targetEpisodeCount: targetIds.length
    });
    return { ok: true };
  }

  private resolveEffectiveEpisodeScopedMode(
    requestedMode: 'ep' | 'epfuture' | 'epseason',
    ordered: SonarrEpisodeRecord[],
    pivot: SonarrEpisodeRecord
  ): 'ep' | 'epfuture' | 'epseason' {
    if (requestedMode !== 'ep') return requestedMode;
    if (this.config.sonarr.epCount <= 1) return 'ep';
    const pivotIndex = ordered.findIndex((item) => item.id === pivot.id);
    if (pivotIndex <= 0) return 'ep';
    const priorWindow = ordered.slice(Math.max(0, pivotIndex - this.config.sonarr.epCountPast), pivotIndex);
    // Stremio addon requests do not include user watch-history credentials, so this
    // heuristic uses locally known library state (downloaded episodes) as the
    // available proxy signal for "already watched/downloaded".
    const priorDownloadedOrWatched = priorWindow.filter((item) => item.hasFile || (item.episodeFileId ?? 0) > 0).length;
    if (priorDownloadedOrWatched >= this.config.sonarr.epCount) {
      this.logger.info('sonarr ep mode upgraded by EP_COUNT', {
        priorDownloadedOrWatched,
        epCount: this.config.sonarr.epCount,
        epCountMod: this.config.sonarr.epCountMod
      });
      return this.config.sonarr.epCountMod;
    }
    return 'ep';
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

    const monitorMode = this.config.sonarr.seriesMonitor;
    const scopedMode = this.isEpisodeScopedMonitorMode(monitorMode) ? monitorMode : undefined;
    if (scopedMode && season != null && episode != null && status.seriesId) {
      const scoped = await this.applyEpisodeMonitoringFromReferencePoint(imdbId, season, episode, scopedMode);
      if (!scoped.ok) {
        return scoped.result;
      }
    } else if (status.seriesId) {
      await this.http.put('/api/v3/series/editor', { seriesIds: [status.seriesId], monitored: true });
      this.invalidateCache();
    }

    if (status.episodeId && !scopedMode) {
      const grabbed = await this.tryGrabTopRelease(status.seriesId, status.episodeId, season);
      if (!grabbed) {
        await this.http.post('/api/v3/command', {
          name: 'EpisodeSearch',
          episodeIds: [status.episodeId]
        });
      }
      this.invalidateCache();
      this.logger.info('sonarr search queued', { imdbId, episodeId: status.episodeId, method: grabbed ? 'release_grab' : 'command_search' });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Search triggered',
        summary: grabbed ? 'Sonarr release grabbed for download.' : 'Sonarr episode search queued.'
      };
    }

    if (status.seriesId) {
      if (scopedMode === 'epseason' && season != null) {
        await this.http.post('/api/v3/command', {
          name: 'SeasonSearch',
          seriesId: status.seriesId,
          seasonNumber: season
        });
      } else {
        const grabbed = scopedMode ? false : await this.tryGrabTopRelease(status.seriesId, undefined, season);
        if (!grabbed) {
          await this.http.post('/api/v3/command', {
            name: 'MissingEpisodeSearch',
            seriesId: status.seriesId
          });
        }
      }
      this.invalidateCache();
      this.logger.info('sonarr search queued', { imdbId, seriesId: status.seriesId, type: scopedMode === 'epseason' ? 'season_search' : 'missing_episode', scopedMode: scopedMode ?? null });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Search triggered',
        summary: scopedMode === 'epseason'
          ? 'Sonarr season search queued.'
          : 'Sonarr missing-episode search queued.'
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
    this.seriesByImdbIdCache.clear();
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

  private async isEpisodeQueued(episodeId: number, _seriesId: number): Promise<boolean> {
    const records = await this.listQueueRecords();
    return records.some((item) => item.episodeId === episodeId);
  }

  private async listQueueRecords(): Promise<SonarrQueueRecord[]> {
    return this.queueCache.getOrSet('records', async () => {
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
      return results;
    });
  }

  async listSeries(): Promise<SonarrSeriesRecord[]> {
    return this.seriesCache.getOrSet('all', async () => {
      return this.http.get<SonarrSeriesRecord[]>('/api/v3/series');
    });
  }

  private async listEpisodes(seriesId: number): Promise<SonarrEpisodeRecord[]> {
    const key = `episodes:${seriesId}`;
    return this.episodeCache.getOrSet(key, async () => {
      return this.http.get<SonarrEpisodeRecord[]>(
        `/api/v3/episode?seriesId=${seriesId}`
      );
    });
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
    return this.queueCache.getOrSet('details', async () => {
      const detailsPath = '/api/v3/queue/details?page=1&pageSize=250&includeUnknownSeriesItems=true';
      let records: SonarrQueueRecord[] = [];

      try {
        const details = await this.http.get<{ records?: SonarrQueueRecord[] } | SonarrQueueRecord[]>(detailsPath);
        records = Array.isArray(details) ? details : (details.records ?? []);
      } catch {
        records = await this.listQueueRecords();
      }

      return records;
    });
  }

  private async findSeriesByImdbId(imdbId: string): Promise<SonarrSeriesRecord | undefined> {
    const seriesMap = await this.getSeriesByImdbIdMap();
    const inLibrary = seriesMap.get(imdbId);
    if (inLibrary) return inLibrary;

    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) return undefined;

    const series = await this.listSeries();
    if (lookup.tvdbId != null) {
      return series.find((item) => item.tvdbId === lookup.tvdbId);
    }
    if (lookup.title && lookup.year != null) {
      return series.find(
        (item) => item.title.toLowerCase() === lookup.title.toLowerCase() && item.year === lookup.year
      );
    }
    return undefined;
  }

  private async lookupSeries(imdbId: string): Promise<SonarrLookupRecord | null> {
    const results = await this.http.get<SonarrLookupRecord[]>(
      `/api/v3/series/lookup?term=${encodeURIComponent(`imdb:${imdbId}`)}`
    );
    return results.find((item) => item.imdbId === imdbId) ?? results[0] ?? null;
  }

  private async tryGrabTopRelease(
    seriesId: number | undefined,
    episodeId: number | undefined,
    season?: number
  ): Promise<boolean> {
    if (!seriesId) {
      return false;
    }
    const params = new URLSearchParams({ seriesId: String(seriesId) });
    if (season != null) {
      params.set('seasonNumber', String(season));
    }
    if (episodeId != null) {
      params.set('episodeId', String(episodeId));
    }
    try {
      const releases = await this.http.get<SonarrReleaseRecord[]>(`/api/v3/release?${params.toString()}`);
      const candidate = releases
        .filter((item) => item.approved && !item.rejected && item.downloadAllowed !== false && item.guid && item.indexerId != null)
        .sort((a, b) => (b.releaseWeight ?? Number.NEGATIVE_INFINITY) - (a.releaseWeight ?? Number.NEGATIVE_INFINITY))[0];
      if (!candidate?.guid || candidate.indexerId == null) {
        return false;
      }
      await this.http.post('/api/v3/release', {
        guid: candidate.guid,
        indexerId: candidate.indexerId,
        ...(episodeId ? { episodeIds: [episodeId] } : { seriesId }),
        ...(candidate.downloadClientId != null ? { downloadClientId: candidate.downloadClientId } : {})
      });
      return true;
    } catch {
      return false;
    }
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
