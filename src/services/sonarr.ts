import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { friendlyErrorMessage, JsonHttpClient } from '../lib/http.js';
import type {
  AddActionResult,
  ArrEpisodeStatus,
  SonarrEpisodeRecord,
  SonarrLookupRecord,
  SonarrSeriesRecord
} from '../types.js';

export interface SonarrSystemStatus {
  version: string;
}

export class SonarrClient {
  private readonly http: JsonHttpClient;
  private readonly seriesCache: TtlCache<SonarrSeriesRecord[]>;
  private readonly episodeCache: TtlCache<SonarrEpisodeRecord[]>;

  constructor(private readonly config: AppConfig) {
    this.http = new JsonHttpClient({
      baseUrl: config.sonarr.baseUrl,
      apiKey: config.sonarr.apiKey,
      timeoutMs: config.requestTimeoutMs
    });
    this.seriesCache = new TtlCache<SonarrSeriesRecord[]>(config.statusCacheTtlMs);
    this.episodeCache = new TtlCache<SonarrEpisodeRecord[]>(config.statusCacheTtlMs);
  }

  async ping(): Promise<boolean> {
    try {
      await this.http.get<SonarrSystemStatus>('/api/v3/system/status');
      return true;
    } catch {
      return false;
    }
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
        return { state: 'series_added', monitored: !!series.monitored };
      }

      const episodes = await this.listEpisodes(series.id);
      const match = episodes.find(
        (item) => item.seasonNumber === season && item.episodeNumber === episode
      );

      if (!match) {
        return { state: 'series_added', monitored: !!series.monitored, reason: 'Episode not found in Sonarr yet.' };
      }

      if (match.hasFile || match.episodeFileId) {
        return { state: 'episode_downloaded', monitored: match.monitored, hasFile: true };
      }
      if (match.monitored) {
        return { state: 'episode_missing', monitored: true, hasFile: false };
      }
      return { state: 'series_added', monitored: !!series.monitored, hasFile: false };
    } catch (error) {
      return {
        state: 'unavailable',
        reason: friendlyErrorMessage(error)
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

    const existing = await this.findSeriesByImdbId(imdbId);
    if (existing) {
      return {
        ok: true,
        service: 'sonarr',
        title: 'Already in Sonarr',
        summary: 'Series is already added to Sonarr.',
        detail: existing.title,
        alreadyExisted: true
      };
    }

    const lookup = await this.lookupSeriesWithFallback(imdbId);
    if (!lookup) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Series lookup failed',
        summary: 'Could not resolve the series in Sonarr lookup.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    if (!this.config.sonarr.rootFolderPath) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Configuration error',
        summary: 'SONARR_ROOT_FOLDER_PATH is not set.',
        detail: 'Set SONARR_ROOT_FOLDER_PATH in .env to a valid path.'
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
      monitorNewItems: this.config.sonarr.seriesMonitor,
      tags: this.config.sonarr.tags,
      addOptions: {
        searchForMissingEpisodes: this.config.sonarr.searchOnAdd,
        searchForCutoffUnmetEpisodes: false
      }
    };

    try {
      await this.http.post('/api/v3/series', payload);
    } catch (error) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Add failed',
        summary: friendlyErrorMessage(error),
        detail: lookup.title
      };
    }

    this.seriesCache.clear();

    return {
      ok: true,
      service: 'sonarr',
      title: 'Added to Sonarr',
      summary: this.config.sonarr.searchOnAdd ? 'Series added and search triggered.' : 'Series added.',
      detail: lookup.title
    };
  }

  private async listSeries(): Promise<SonarrSeriesRecord[]> {
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

  private async findSeriesByImdbId(imdbId: string): Promise<SonarrSeriesRecord | undefined> {
    const series = await this.listSeries();
    return series.find((item) => item.imdbId === imdbId);
  }

  private async lookupSeriesWithFallback(imdbId: string): Promise<SonarrLookupRecord | null> {
    // Primary: IMDb-specific lookup
    try {
      const results = await this.http.get<SonarrLookupRecord[]>(
        `/api/v3/series/lookup?term=${encodeURIComponent(`imdb:${imdbId}`)}`
      );
      const match = results.find((item) => item.imdbId === imdbId) ?? results[0] ?? null;
      if (match) return match;
    } catch {
      // fall through to return null — fallback text search is not implemented
      // TODO: add text-based fallback lookup if Sonarr's IMDb lookup returns empty results.
      // A title source would be needed (e.g., from a TMDB lookup using TMDB_API_KEY).
      // See AGENTS.md "Expected future work" for context.
    }
    return null;
  }
}
