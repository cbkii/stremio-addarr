import type { AppConfig } from '../config.js';
import { TtlCache } from '../lib/cache.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../lib/http.js';
import type {
  AddActionResult,
  ArrEpisodeStatus,
  SonarrEpisodeRecord,
  SonarrLookupRecord,
  SonarrSeriesRecord
} from '../types.js';

export class SonarrClient {
  private readonly http: JsonHttpClient;
  private readonly seriesCache: TtlCache<SonarrSeriesRecord[]>;
  private readonly episodeCache: TtlCache<SonarrEpisodeRecord[]>;

  constructor(
    private readonly config: AppConfig,
    injectedHttp?: JsonHttpClient
  ) {
    this.http =
      injectedHttp ??
      new JsonHttpClient({
        baseUrl: config.sonarr.baseUrl,
        apiKey: config.sonarr.apiKey,
        timeoutMs: config.requestTimeoutMs
      });
    this.seriesCache = new TtlCache<SonarrSeriesRecord[]>(config.statusCacheTtlMs);
    this.episodeCache = new TtlCache<SonarrEpisodeRecord[]>(config.statusCacheTtlMs);
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

      if (match.hasFile || (match.episodeFileId ?? 0) > 0) {
        return { state: 'episode_downloaded', monitored: match.monitored, hasFile: true };
      }
      if (match.monitored) {
        return { state: 'episode_missing', monitored: true, hasFile: false };
      }
      return { state: 'series_added', monitored: !!series.monitored, hasFile: false };
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

    const current = await this.findSeriesByImdbId(imdbId);
    if (current) {
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
      return {
        ok: false,
        service: 'sonarr',
        title: 'Series lookup failed',
        summary: 'Could not resolve the series in Sonarr lookup.',
        detail: `IMDb id: ${imdbId}`
      };
    }

    if (!lookup.tvdbId) {
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
      if (
        error instanceof HttpError &&
        error.status === 400 &&
        /already been added/i.test(error.body)
      ) {
        this.seriesCache.clear();
        this.episodeCache.clear();
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
