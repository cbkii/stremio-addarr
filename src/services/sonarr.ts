import type { AppConfig } from '../config.js';
import { AsyncTtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import { createLogger } from '../logger.js';
import type {
  AddActionResult,
  ArrCommandResponse,
  ArrEpisodeStatus,
  ArrQualityProfile,
  SonarrEpisodeRecord,
  SonarrHistoryRecord,
  SonarrLookupRecord,
  SonarrQueueRecord,
  SonarrSeriesRecord
} from '../types.js';

interface SeriesSnapshot {
  series: SonarrSeriesRecord[];
  byImdbId: Map<string, SonarrSeriesRecord>;
  byTvdbId: Map<number, SonarrSeriesRecord>;
}

export class SonarrClient {
  private readonly http: JsonHttpClient;
  private readonly logger: ReturnType<typeof createLogger>;
  private readonly seriesSnapshotCache: AsyncTtlCache<SeriesSnapshot>;
  private readonly episodeCache: AsyncTtlCache<SonarrEpisodeRecord[]>;
  private readonly queueCache: AsyncTtlCache<SonarrQueueRecord[]>;
  private readonly qualityProfileCache: AsyncTtlCache<ArrQualityProfile[]>;

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
    this.seriesSnapshotCache = new AsyncTtlCache<SeriesSnapshot>(config.statusCacheTtlMs);
    this.episodeCache = new AsyncTtlCache<SonarrEpisodeRecord[]>(config.statusCacheTtlMs);
    this.queueCache = new AsyncTtlCache<SonarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));
    this.qualityProfileCache = new AsyncTtlCache<ArrQualityProfile[]>(Math.max(config.statusCacheTtlMs, 60_000));
  }

  private async getSeriesSnapshot(): Promise<SeriesSnapshot> {
    return this.seriesSnapshotCache.getOrSet('snapshot', async () => {
      const series = await this.http.get<SonarrSeriesRecord[]>('/api/v3/series');
      const byImdbId = new Map<string, SonarrSeriesRecord>();
      const byTvdbId = new Map<number, SonarrSeriesRecord>();
      for (const item of series) {
        if (item.imdbId) byImdbId.set(item.imdbId.toLowerCase(), item);
        if (item.tvdbId != null) byTvdbId.set(item.tvdbId, item);
      }
      return { series, byImdbId, byTvdbId };
    });
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
    if (!this.config.sonarr.enabled) return { state: 'unavailable', reason: 'Sonarr is disabled.' };

    try {
      const series = await this.findSeriesByImdbId(imdbId);
      if (!series) return { state: 'series_not_added' };
      const qualityProfileName = await this.qualityProfileName(series.qualityProfileId);
      const common = {
        seriesId: series.id,
        seriesMonitored: Boolean(series.monitored),
        monitored: Boolean(series.monitored),
        title: series.title,
        qualityProfileId: series.qualityProfileId,
        qualityProfileName,
        monitorNewItems: series.monitorNewItems,
        existingItemPolicy: this.config.sonarr.existingItemPolicy,
        seasonMonitored: season == null ? undefined : series.seasons?.find((item) => item.seasonNumber === season)?.monitored
      };
      if (season == null || episode == null) return { state: 'series_added', ...common };

      const episodes = await this.listEpisodes(series.id);
      const match = episodes.find((item) => item.seasonNumber === season && item.episodeNumber === episode);
      const episodeReleaseDate = this.pickEpisodeReleaseDate(match?.airDateUtc, match?.airDate);
      if (!match) return { state: 'series_added', ...common, reason: 'Episode not found in Sonarr yet.' };
      const episodeCommon = { ...common, episodeId: match.id, monitored: Boolean(match.monitored), episodeReleaseDate };

      if (match.hasFile || (match.episodeFileId ?? 0) > 0) {
        const rawFileName = match.episodeFile?.relativePath ?? match.episodeFile?.path;
        const fileName = rawFileName ? rawFileName.split(/[\/]/).pop() : undefined;
        return {
          state: 'episode_downloaded',
          ...episodeCommon,
          episodeFileId: match.episodeFileId,
          hasFile: true,
          fileName,
          fileSizeBytes: match.episodeFile?.size
        };
      }

      let isDownloading = false;
      try { isDownloading = await this.isEpisodeQueued(match.id, series.id); } catch { isDownloading = false; }
      if (isDownloading) return { state: 'episode_downloading', ...episodeCommon, hasFile: false };
      if (match.monitored) return { state: 'episode_missing', ...episodeCommon, monitored: true, hasFile: false };
      return { state: 'series_added', ...episodeCommon, monitored: false, hasFile: false };
    } catch (error) {
      return { state: 'unavailable', reason: error instanceof Error ? error.message : 'Unknown Sonarr error.' };
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
    const current = await this.findSeriesByImdbId(imdbId, true);
    if (current) {
      this.logger.info('sonarr add skipped', { imdbId, reason: 'already_exists', title: current.title });
      return {
        ok: true,
        service: 'sonarr',
        title: 'Already in Sonarr',
        summary: 'Series is already added to Sonarr.',
        detail: current.title,
        alreadyExisted: true,
        itemId: current.id
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
        searchForMissingEpisodes: false,
        searchForCutoffUnmetEpisodes: false
      }
    };

    let created: SonarrSeriesRecord;
    try {
      created = await this.http.post<SonarrSeriesRecord>('/api/v3/series', payload);
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
        monitorMode,
        created?.id
      );
      if (!applied.ok) {
        return applied.result;
      }
    }

    this.logger.info('sonarr add success', { imdbId, title: lookup.title, searchOnAdd: false });
    return {
      ok: true,
      service: 'sonarr',
      title: 'Added to Sonarr',
      summary: 'Series added.',
      detail: lookup.title,
      itemId: created?.id
    };
  }

  private async applyEpisodeMonitoringFromReferencePoint(
    imdbId: string,
    season: number,
    episode: number,
    mode: 'ep' | 'epfuture' | 'epseason',
    knownSeriesId?: number
  ): Promise<{ ok: true } | { ok: false; result: AddActionResult }> {
    const startedAt = Date.now();
    let series: SonarrSeriesRecord | undefined = knownSeriesId != null
      ? { id: knownSeriesId, imdbId, title: imdbId }
      : undefined;
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

  async triggerEpisodeSearch(
    imdbId: string,
    season?: number,
    episode?: number,
    options: { existingBeforeAction?: boolean; knownSeriesId?: number; knownTitle?: string } = { existingBeforeAction: true }
  ): Promise<AddActionResult> {
    this.logger.info('sonarr search start', { imdbId, season, episode });
    if (season == null || episode == null) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Exact episode required',
        summary: 'This action requires a season and episode number; no broad series search was started.'
      };
    }

    let series: SonarrSeriesRecord | undefined = options.knownSeriesId != null
      ? { id: options.knownSeriesId, imdbId, title: options.knownTitle ?? imdbId }
      : undefined;
    try {
      series ??= await this.findSeriesByImdbId(imdbId, true);
    } catch (error) {
      return { ok: false, service: 'sonarr', title: 'Sonarr unavailable', summary: error instanceof Error ? error.message : 'Sonarr lookup failed.' };
    }
    if (!series) return { ok: false, service: 'sonarr', title: 'Not in Sonarr', summary: 'Series is not added yet.' };

    let exact: SonarrEpisodeRecord | undefined;
    try {
      exact = await this.waitForEpisode(series.id, season, episode);
    } catch (error) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr action failed',
        summary: error instanceof Error ? error.message : 'Sonarr could not resolve the exact episode.',
        detail: `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      };
    }
    if (!exact) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Episode not ready',
        summary: `S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} did not appear in Sonarr before the readiness timeout. No broad search was started.`
      };
    }
    if (exact.hasFile || (exact.episodeFileId ?? 0) > 0) {
      return { ok: true, service: 'sonarr', title: 'Already downloaded', summary: 'Episode file already exists.', detail: series.title, alreadyExisted: true };
    }

    let policyDetail: string;
    let command: ArrCommandResponse;
    try {
      policyDetail = options.existingBeforeAction === false
        ? 'Configured settings applied to the new series.'
        : await this.applyExistingSeriesPolicy(imdbId, series, exact, season, episode);
      command = await this.http.post<ArrCommandResponse>('/api/v3/command', {
        name: 'EpisodeSearch',
        episodeIds: [exact.id]
      });
    } catch (error) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Sonarr action failed',
        summary: error instanceof Error ? error.message : 'Sonarr rejected the series policy or episode search request.',
        detail: `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      };
    }
    const commandName = command?.name?.trim().toLowerCase();
    if (!Number.isInteger(command?.id) || Number(command.id) <= 0 || (commandName != null && commandName !== 'episodesearch')) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Search was not accepted',
        summary: 'Sonarr did not return a valid targeted EpisodeSearch acknowledgement.',
        detail: `${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}`
      };
    }

    this.invalidateCache();
    return {
      ok: true,
      service: 'sonarr',
      title: 'Episode search queued',
      summary: `Targeted search queued for ${series.title} S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')}.`,
      detail: policyDetail,
      commandId: command.id
    };
  }

  private async waitForEpisode(seriesId: number, season: number, episode: number): Promise<SonarrEpisodeRecord | undefined> {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < this.config.sonarr.episodeReadyTimeoutMs) {
      const episodes = await this.listEpisodes(seriesId);
      const exact = episodes.find((item) => item.seasonNumber === season && item.episodeNumber === episode);
      if (exact) return exact;
      this.episodeCache.clear();
      await this.sleep(this.config.sonarr.episodeReadyPollMs);
    }
    return undefined;
  }

  private async applyExistingSeriesPolicy(
    imdbId: string,
    series: SonarrSeriesRecord,
    exact: SonarrEpisodeRecord,
    season: number,
    episode: number
  ): Promise<string> {
    const policy = this.config.sonarr.existingItemPolicy;
    if (policy === 'preserve') return 'Existing profile and monitoring settings were preserved.';

    if (policy === 'extend') {
      if (!series.monitored) {
        await this.http.put('/api/v3/series/editor', { seriesIds: [series.id], monitored: true });
      }
      if (!exact.monitored) {
        await this.http.put('/api/v3/episode/monitor', { episodeIds: [exact.id], monitored: true });
      }
      return 'Existing profile and new-item policy were preserved; selected monitoring was only extended.';
    }

    const monitorMode = this.config.sonarr.seriesMonitor;
    await this.http.put('/api/v3/series/editor', {
      seriesIds: [series.id],
      monitored: monitorMode !== 'none',
      monitorNewItems: this.config.sonarr.monitorNewItems === 'auto'
        ? (monitorMode === 'epfuture' || monitorMode === 'future' || monitorMode === 'all' ? 'all' : 'none')
        : this.config.sonarr.monitorNewItems,
      qualityProfileId: this.config.sonarr.qualityProfileId,
      rootFolderPath: this.config.sonarr.rootFolderPath,
      tags: this.config.sonarr.tags,
      applyTags: 'replace',
      moveFiles: false
    });

    if (this.isEpisodeScopedMonitorMode(monitorMode)) {
      const applied = await this.applyEpisodeMonitoringFromReferencePoint(imdbId, season, episode, monitorMode);
      if (!applied.ok) throw new Error(applied.result.summary);
    } else {
      await this.applyConfiguredNonScopedMonitoring(series.id, monitorMode);
    }
    return `Configured Sonarr settings were applied (Profile ${this.config.sonarr.qualityProfileId}).`;
  }

  private async applyConfiguredNonScopedMonitoring(
    seriesId: number,
    mode: Exclude<AppConfig['sonarr']['seriesMonitor'], 'ep' | 'epfuture' | 'epseason'>
  ): Promise<void> {
    if (mode === 'skip') return;
    const episodes = await this.listEpisodes(seriesId);
    const regular = episodes
      .filter((item) => item.id > 0 && item.seasonNumber > 0 && item.episodeNumber > 0)
      .sort((a, b) => a.seasonNumber - b.seasonNumber || a.episodeNumber - b.episodeNumber);
    const specials = episodes.filter((item) => item.id > 0 && item.seasonNumber === 0);

    if (mode === 'monitorSpecials' || mode === 'unmonitorSpecials') {
      if (specials.length > 0) {
        await this.http.put('/api/v3/episode/monitor', {
          episodeIds: specials.map((item) => item.id),
          monitored: mode === 'monitorSpecials'
        });
      }
      return;
    }

    let target: SonarrEpisodeRecord[] = [];
    const seasons = [...new Set(regular.map((item) => item.seasonNumber))].sort((a, b) => a - b);
    const firstSeason = seasons[0];
    const lastSeason = seasons[seasons.length - 1];
    const now = Date.now();
    switch (mode) {
      case 'all': target = regular; break;
      case 'future': target = regular.filter((item) => {
        const when = Date.parse(item.airDateUtc ?? item.airDate ?? '');
        return Number.isFinite(when) && when >= now;
      }); break;
      case 'missing': target = regular.filter((item) => !item.hasFile && (item.episodeFileId ?? 0) <= 0); break;
      case 'existing': target = regular.filter((item) => item.hasFile || (item.episodeFileId ?? 0) > 0); break;
      case 'firstSeason': target = regular.filter((item) => item.seasonNumber === firstSeason); break;
      case 'lastSeason':
      case 'latestSeason':
      case 'recent': target = regular.filter((item) => item.seasonNumber === lastSeason); break;
      case 'pilot': target = regular.slice(0, 1); break;
      case 'none': target = []; break;
      default: target = regular; break;
    }
    if (regular.length > 0) {
      await this.http.put('/api/v3/episode/monitor', { episodeIds: regular.map((item) => item.id), monitored: false });
    }
    if (target.length > 0) {
      await this.http.put('/api/v3/episode/monitor', { episodeIds: target.map((item) => item.id), monitored: true });
    }
  }

  invalidateCache(): void {
    this.seriesSnapshotCache.clear();
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
    const snapshot = await this.getSeriesSnapshot();
    return snapshot.series;
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

  private async findSeriesByImdbId(imdbId: string, fresh = false): Promise<SonarrSeriesRecord | undefined> {
    if (fresh) this.seriesSnapshotCache.clear();
    const snapshot = await this.getSeriesSnapshot();
    const inLibrary = snapshot.byImdbId.get(imdbId.toLowerCase());
    if (inLibrary) return inLibrary;

    let lookup: SonarrLookupRecord | null = null;
    try {
      lookup = await this.lookupSeries(imdbId);
    } catch {
      return undefined;
    }
    if (!lookup) return undefined;
    if (lookup.tvdbId != null) return snapshot.byTvdbId.get(lookup.tvdbId);
    if (lookup.title && lookup.year != null) {
      return snapshot.series.find((item) => item.title.toLowerCase() === lookup.title.toLowerCase() && item.year === lookup.year);
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
