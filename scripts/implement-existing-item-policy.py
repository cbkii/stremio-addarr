from __future__ import annotations

import re
from pathlib import Path

ROOT = Path.cwd()


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    if text.count(old) != 1:
        raise SystemExit(f'{path}: expected one exact occurrence, found {text.count(old)}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str, flags: int = re.S) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex occurrence, found {count}: {pattern[:120]!r}')
    write(path, updated)


# Configuration model
replace_once(
    'src/config.ts',
    "import type { ConfigValidation } from './types.js';\n",
    "import type { ConfigValidation } from './types.js';\n\nexport type ExistingItemPolicy = 'preserve' | 'extend' | 'apply-config';\n",
)
replace_once(
    'src/config.ts',
    "    strictImdbMatch: boolean;\n  };",
    "    strictImdbMatch: boolean;\n    existingItemPolicy: ExistingItemPolicy;\n  };",
)
replace_once(
    'src/config.ts',
    "    searchOnAdd: boolean;\n  };\n  traktSync:",
    "    searchOnAdd: boolean;\n    existingItemPolicy: ExistingItemPolicy;\n  };\n  traktSync:",
)
replace_once(
    'src/config.ts',
    "const SONARR_MONITOR_NEW_ITEMS = new Set<AppConfig['sonarr']['monitorNewItems']>(['auto', 'all', 'none']);\n",
    "const SONARR_MONITOR_NEW_ITEMS = new Set<AppConfig['sonarr']['monitorNewItems']>(['auto', 'all', 'none']);\nconst EXISTING_ITEM_POLICIES = new Set<ExistingItemPolicy>(['preserve', 'extend', 'apply-config']);\n",
)
replace_once(
    'src/config.ts',
    "function parseSonarrMonitorNewItems(value: string): AppConfig['sonarr']['monitorNewItems'] {",
    "function parseExistingItemPolicy(name: string, value: string): ExistingItemPolicy {\n  const normalized = value.trim().toLowerCase() as ExistingItemPolicy;\n  if (!EXISTING_ITEM_POLICIES.has(normalized)) {\n    throw new Error(`${name} must be one of: preserve, extend, apply-config.`);\n  }\n  return normalized;\n}\n\nfunction parseSonarrMonitorNewItems(value: string): AppConfig['sonarr']['monitorNewItems'] {",
)
replace_once(
    'src/config.ts',
    "    searchOnAdd: readBoolean('RADARR_SEARCH_ON_ADD', true),\n    strictImdbMatch: readBoolean('RADARR_STRICT_IMDB_MATCH', false)",
    "    searchOnAdd: readBoolean('RADARR_SEARCH_ON_ADD', true),\n    strictImdbMatch: readBoolean('RADARR_STRICT_IMDB_MATCH', false),\n    existingItemPolicy: parseExistingItemPolicy('RADARR_EXISTING_ITEM_POLICY', readString('RADARR_EXISTING_ITEM_POLICY', 'preserve'))",
)
replace_once(
    'src/config.ts',
    "    tags: readIntegerListEnv('SONARR_TAGS'),\n    searchOnAdd: readBoolean('SONARR_SEARCH_ON_ADD', true)",
    "    tags: readIntegerListEnv('SONARR_TAGS'),\n    searchOnAdd: readBoolean('SONARR_SEARCH_ON_ADD', true),\n    existingItemPolicy: parseExistingItemPolicy('SONARR_EXISTING_ITEM_POLICY', readString('SONARR_EXISTING_ITEM_POLICY', 'preserve'))",
)

# Shared Arr types
replace_once('src/types.ts', "export type ContentKind = 'movie' | 'series';\n", "import type { ExistingItemPolicy } from './config.js';\n\nexport type ContentKind = 'movie' | 'series';\n")
replace_once(
    'src/types.ts',
    "  reason?: string;\n}\n\nexport interface ArrEpisodeStatus",
    "  reason?: string;\n  qualityProfileId?: number;\n  qualityProfileName?: string;\n  existingItemPolicy?: ExistingItemPolicy;\n}\n\nexport interface ArrEpisodeStatus",
)
replace_once(
    'src/types.ts',
    "  reason?: string;\n}\n\nexport interface AddActionResult",
    "  reason?: string;\n  qualityProfileId?: number;\n  qualityProfileName?: string;\n  existingItemPolicy?: ExistingItemPolicy;\n  seriesMonitored?: boolean;\n  seasonMonitored?: boolean;\n  monitorNewItems?: 'all' | 'none';\n}\n\nexport interface AddActionResult",
)
replace_once(
    'src/types.ts',
    "  alreadyExisted?: boolean;\n}\n\nexport interface ServiceHealth",
    "  alreadyExisted?: boolean;\n  commandId?: number;\n}\n\nexport interface ArrCommandResponse {\n  id?: number;\n  name?: string;\n  status?: string;\n}\n\nexport interface ArrQualityProfile {\n  id: number;\n  name: string;\n}\n\nexport interface ServiceHealth",
)
replace_once(
    'src/types.ts',
    "  added?: string;\n  images?: Array<{ coverType?: string; remoteUrl?: string; url?: string }>;",
    "  added?: string;\n  qualityProfileId?: number;\n  minimumAvailability?: string;\n  rootFolderPath?: string;\n  tags?: number[];\n  images?: Array<{ coverType?: string; remoteUrl?: string; url?: string }>;",
)
replace_once(
    'src/types.ts',
    "  monitored?: boolean;\n  added?: string;\n  statistics?: {",
    "  monitored?: boolean;\n  added?: string;\n  qualityProfileId?: number;\n  monitorNewItems?: 'all' | 'none';\n  rootFolderPath?: string;\n  tags?: number[];\n  seasons?: Array<{ seasonNumber: number; monitored?: boolean }>;\n  statistics?: {",
)

# Radarr client
replace_once(
    'src/services/radarr.ts',
    "  AddActionResult,\n  ArrMovieStatus,",
    "  AddActionResult,\n  ArrCommandResponse,\n  ArrMovieStatus,\n  ArrQualityProfile,",
)
replace_once(
    'src/services/radarr.ts',
    "  byImdbId: Map<string, RadarrMovieRecord>;\n}",
    "  byImdbId: Map<string, RadarrMovieRecord>;\n  byTmdbId: Map<number, RadarrMovieRecord>;\n}",
)
replace_once(
    'src/services/radarr.ts',
    "  private readonly queueCache: AsyncTtlCache<RadarrQueueRecord[]>;",
    "  private readonly queueCache: AsyncTtlCache<RadarrQueueRecord[]>;\n  private readonly qualityProfileCache: AsyncTtlCache<ArrQualityProfile[]>;",
)
replace_once(
    'src/services/radarr.ts',
    "    this.queueCache = new AsyncTtlCache<RadarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));",
    "    this.queueCache = new AsyncTtlCache<RadarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));\n    this.qualityProfileCache = new AsyncTtlCache<ArrQualityProfile[]>(Math.max(config.statusCacheTtlMs, 60_000));",
)
sub_once(
    'src/services/radarr.ts',
    r"  private async getMoviesSnapshot\(\): Promise<MoviesSnapshot> \{.*?\n  \}\n\n  async getMovieStatus",
    """  private async getMoviesSnapshot(): Promise<MoviesSnapshot> {
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

  async getMovieStatus""",
)
sub_once(
    'src/services/radarr.ts',
    r"  async getMovieStatus\(imdbId: string\): Promise<ArrMovieStatus> \{.*?\n  \}\n\n  private pickMovieReleaseDate",
    """  async getMovieStatus(imdbId: string): Promise<ArrMovieStatus> {
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
        const fileName = rawFileName ? rawFileName.split(/[\\/]/).pop() : undefined;
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

  private pickMovieReleaseDate""",
)
sub_once(
    'src/services/radarr.ts',
    r"    const current = await this.getMovieStatus\(imdbId\);\n    if \(current.state === 'downloaded'.*?\n    \}\n\n    const candidates",
    """    const existing = await this.findMovieByImdbId(imdbId, true);
    if (existing) {
      const profile = await this.qualityProfileName(existing.qualityProfileId);
      this.logger.info('radarr add skipped', { imdbId, reason: 'already_exists', movieId: existing.id });
      return {
        ok: true,
        service: 'radarr',
        title: 'Already in Radarr',
        summary: existing.hasFile || existing.movieFile ? 'Movie is already downloaded.' : 'Movie is already added.',
        detail: `${existing.title}${profile ? ` · ${profile}` : ''}`,
        alreadyExisted: true
      };
    }

    const candidates""",
)
replace_once('src/services/radarr.ts', "        searchForMovie: this.config.radarr.searchOnAdd", "        searchForMovie: false")
replace_once('src/services/radarr.ts', "      searchOnAdd: this.config.radarr.searchOnAdd", "      searchOnAdd: false")
replace_once('src/services/radarr.ts', "      summary: this.config.radarr.searchOnAdd ? 'Movie added and search triggered.' : 'Movie added.',", "      summary: 'Movie added.',")
sub_once(
    'src/services/radarr.ts',
    r"  async triggerMovieSearch\(imdbId: string\): Promise<AddActionResult> \{.*?\n  \}\n\n  private async tryGrabTopRelease",
    """  async triggerMovieSearch(
    imdbId: string,
    options: { existingBeforeAction?: boolean } = { existingBeforeAction: true }
  ): Promise<AddActionResult> {
    this.logger.info('radarr search start', { imdbId });
    let existing: RadarrMovieRecord | undefined;
    try {
      existing = await this.findMovieByImdbId(imdbId, true);
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
    if (!Number.isInteger(command?.id) || Number(command.id) <= 0) {
      return {
        ok: false,
        service: 'radarr',
        title: 'Search was not accepted',
        summary: 'Radarr did not return a valid command acknowledgement.',
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

  private async tryGrabTopRelease""",
)

# Sonarr client
replace_once(
    'src/services/sonarr.ts',
    "  AddActionResult,\n  ArrEpisodeStatus,",
    "  AddActionResult,\n  ArrCommandResponse,\n  ArrEpisodeStatus,\n  ArrQualityProfile,",
)
replace_once('src/services/sonarr.ts', "  byImdbId: Map<string, SonarrSeriesRecord>;\n}", "  byImdbId: Map<string, SonarrSeriesRecord>;\n  byTvdbId: Map<number, SonarrSeriesRecord>;\n}")
replace_once('src/services/sonarr.ts', "  private readonly queueCache: AsyncTtlCache<SonarrQueueRecord[]>;", "  private readonly queueCache: AsyncTtlCache<SonarrQueueRecord[]>;\n  private readonly qualityProfileCache: AsyncTtlCache<ArrQualityProfile[]>;")
replace_once('src/services/sonarr.ts', "    this.queueCache = new AsyncTtlCache<SonarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));", "    this.queueCache = new AsyncTtlCache<SonarrQueueRecord[]>(Math.max(1000, Math.floor(config.statusCacheTtlMs / 3)));\n    this.qualityProfileCache = new AsyncTtlCache<ArrQualityProfile[]>(Math.max(config.statusCacheTtlMs, 60_000));")
sub_once(
    'src/services/sonarr.ts',
    r"  private async getSeriesSnapshot\(\): Promise<SeriesSnapshot> \{.*?\n  \}\n\n  private async sleep",
    """  private async getSeriesSnapshot(): Promise<SeriesSnapshot> {
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

  private async sleep""",
)
sub_once(
    'src/services/sonarr.ts',
    r"  async getEpisodeStatus\(imdbId: string, season\?: number, episode\?: number\): Promise<ArrEpisodeStatus> \{.*?\n  \}\n\n  private pickEpisodeReleaseDate",
    """  async getEpisodeStatus(imdbId: string, season?: number, episode?: number): Promise<ArrEpisodeStatus> {
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
        const fileName = rawFileName ? rawFileName.split(/[\\/]/).pop() : undefined;
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

  private pickEpisodeReleaseDate""",
)
replace_once('src/services/sonarr.ts', "    const current = await this.findSeriesByImdbId(imdbId);", "    const current = await this.findSeriesByImdbId(imdbId, true);")
replace_once('src/services/sonarr.ts', "        searchForMissingEpisodes: this.config.sonarr.searchOnAdd,", "        searchForMissingEpisodes: false,")
replace_once('src/services/sonarr.ts', "    this.logger.info('sonarr add success', { imdbId, title: lookup.title, searchOnAdd: this.config.sonarr.searchOnAdd });", "    this.logger.info('sonarr add success', { imdbId, title: lookup.title, searchOnAdd: false });")
replace_once('src/services/sonarr.ts', "      summary: this.config.sonarr.searchOnAdd ? 'Series added and search triggered.' : 'Series added.',", "      summary: 'Series added.',")
sub_once(
    'src/services/sonarr.ts',
    r"  async triggerEpisodeSearch\(imdbId: string, season\?: number, episode\?: number\): Promise<AddActionResult> \{.*?\n  \}\n\n  invalidateCache",
    """  async triggerEpisodeSearch(
    imdbId: string,
    season?: number,
    episode?: number,
    options: { existingBeforeAction?: boolean } = { existingBeforeAction: true }
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

    let series: SonarrSeriesRecord | undefined;
    try {
      series = await this.findSeriesByImdbId(imdbId, true);
    } catch (error) {
      return { ok: false, service: 'sonarr', title: 'Sonarr unavailable', summary: error instanceof Error ? error.message : 'Sonarr lookup failed.' };
    }
    if (!series) return { ok: false, service: 'sonarr', title: 'Not in Sonarr', summary: 'Series is not added yet.' };

    const exact = await this.waitForEpisode(series.id, season, episode);
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

    const policyDetail = options.existingBeforeAction === false
      ? 'Configured settings applied to the new series.'
      : await this.applyExistingSeriesPolicy(imdbId, series, exact, season, episode);

    const command = await this.http.post<ArrCommandResponse>('/api/v3/command', {
      name: 'EpisodeSearch',
      episodeIds: [exact.id]
    });
    if (!Number.isInteger(command?.id) || Number(command.id) <= 0) {
      return {
        ok: false,
        service: 'sonarr',
        title: 'Search was not accepted',
        summary: 'Sonarr did not return a valid command acknowledgement.',
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

  invalidateCache""",
)
sub_once(
    'src/services/sonarr.ts',
    r"  private async findSeriesByImdbId\(imdbId: string\): Promise<SonarrSeriesRecord \| undefined> \{.*?\n  \}\n\n  private async lookupSeries",
    """  private async findSeriesByImdbId(imdbId: string, fresh = false): Promise<SonarrSeriesRecord | undefined> {
    if (fresh) this.seriesSnapshotCache.clear();
    const snapshot = await this.getSeriesSnapshot();
    const inLibrary = snapshot.byImdbId.get(imdbId.toLowerCase());
    if (inLibrary) return inLibrary;

    const lookup = await this.lookupSeries(imdbId);
    if (!lookup) return undefined;
    if (lookup.tvdbId != null) return snapshot.byTvdbId.get(lookup.tvdbId);
    if (lookup.title && lookup.year != null) {
      return snapshot.series.find((item) => item.title.toLowerCase() === lookup.title.toLowerCase() && item.year === lookup.year);
    }
    return undefined;
  }

  private async lookupSeries""",
)

# Status/action orchestration and tile copy
replace_once('src/services/status.ts', "import { NoopWatchedLookup, type WatchedLookup } from './watched.js';", "import { NoopWatchedLookup, type WatchedLookup } from './watched.js';\nimport { seriesMonitorScopeLine } from './series-monitor-scope.js';")
replace_once(
    'src/services/status.ts',
    "function watchedLine(watched: boolean, borderFallback: boolean): string {",
    "function profileLine(profileName?: string, profileId?: number): string {\n  if (profileName) return `🎚️: ${profileName}`;\n  if (profileId != null) return `🎚️: Profile ${profileId}`;\n  return '';\n}\n\nfunction existingPolicyLine(policy?: AppConfig['radarr']['existingItemPolicy']): string {\n  if (policy === 'apply-config') return '⚠️: configured settings will replace existing';\n  if (policy === 'extend') return '➕: existing settings kept; monitoring may extend';\n  return '🛡️: existing settings kept';\n}\n\nfunction actualSeriesMonitorLine(status: ArrEpisodeStatus): string {\n  const series = status.seriesMonitored ? 'series on' : 'series off';\n  const episode = status.episodeId != null ? (status.monitored ? 'ep on' : 'ep off') : '';\n  const future = status.monitorNewItems === 'all' ? '✅new' : status.monitorNewItems === 'none' ? '❌new' : '';\n  return `📡: ${[series, episode, future].filter(Boolean).join(' ')}`;\n}\n\nfunction watchedLine(watched: boolean, borderFallback: boolean): string {",
)
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ Monitored — file missing', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ Monitored — file missing', existingPolicyLine(status.existingItemPolicy), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),")
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ In Library — not monitored', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '⭕ In Library — not monitored', existingPolicyLine(status.existingItemPolicy), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.radarrCardLine()),")
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), '🗯️ ➕  ADD + SEARCH ►', this.radarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), movieLine(status.title, status.releaseDate, this.config.timeZone), `🎚️: Profile ${this.config.radarr.qualityProfileId}`, '🗯️ ➕  ADD + SEARCH ►', this.radarrCardLine()),")
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', existingPolicyLine(status.existingItemPolicy), actualSeriesMonitorLine(status), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),")
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} ${status.monitored ? 'monitored' : 'unmonitored'}` : '⭕ In library', existingPolicyLine(status.existingItemPolicy), actualSeriesMonitorLine(status), profileLine(status.qualityProfileName, status.qualityProfileId), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),")
replace_once('src/services/status.ts', "description: desc(watchedLine(watched, borderFallback), '📺  Not in Sonarr', ep, '🗯️ ➕  ADD SERIES + SEARCH ►', this.sonarrCardLine()),", "description: desc(watchedLine(watched, borderFallback), '📺  Not in Sonarr', ep, seriesMonitorScopeLine(this.config.sonarr), `🎚️: Profile ${this.config.sonarr.qualityProfileId}`, '🗯️ ➕  ADD SERIES + SEARCH ►', this.sonarrCardLine()),")
replace_once('src/services/status.ts', "      const result = await this.radarr.triggerMovieSearch(parsed.imdbId);", "      const result = await this.radarr.triggerMovieSearch(parsed.imdbId, { existingBeforeAction: true });")
replace_once('src/services/status.ts', "    const result = await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode);", "    const result = await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode, { existingBeforeAction: true });")
replace_once('src/services/status.ts', "    const searched = await this.triggerSearch(parsed);", "    const searched = parsed.kind === 'movie'\n      ? await this.radarr.triggerMovieSearch(parsed.imdbId, { existingBeforeAction: added.alreadyExisted === true })\n      : await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode, { existingBeforeAction: added.alreadyExisted === true });\n    this.invalidateStatusCaches();")
replace_once('src/addon.ts', "import { addSeriesMonitorScopeToActionTiles } from './services/series-monitor-scope.js';\n", '')
replace_once('src/addon.ts', "    const displayTiles = parsed.kind === 'series'\n      ? addSeriesMonitorScopeToActionTiles(tiles, config.sonarr)\n      : tiles;", "    const displayTiles = tiles;")

# Configure UI/server persistence
replace_once('src/config-ui-core.ts', "    strictImdbMatch: boolean;\n  };", "    strictImdbMatch: boolean;\n    existingItemPolicy: AppConfig['radarr']['existingItemPolicy'];\n  };")
replace_once('src/config-ui-core.ts', "    searchOnAdd: boolean;\n  };\n  playback:", "    searchOnAdd: boolean;\n    existingItemPolicy: AppConfig['sonarr']['existingItemPolicy'];\n  };\n  playback:")
replace_once('src/config-ui-core.ts', "  'RADARR_STRICT_IMDB_MATCH',", "  'RADARR_STRICT_IMDB_MATCH',\n  'RADARR_EXISTING_ITEM_POLICY',")
replace_once('src/config-ui-core.ts', "  'SONARR_SEARCH_ON_ADD',", "  'SONARR_SEARCH_ON_ADD',\n  'SONARR_EXISTING_ITEM_POLICY',")
replace_once('src/config-ui-core.ts', "const PLAYBACK_MODES = new Set<AppConfig['fileStreaming']['playbackMode']>(['direct', 'kodi']);", "const PLAYBACK_MODES = new Set<AppConfig['fileStreaming']['playbackMode']>(['direct', 'kodi']);\nconst EXISTING_ITEM_POLICIES = new Set<AppConfig['radarr']['existingItemPolicy']>(['preserve', 'extend', 'apply-config']);")
replace_once('src/config-ui-core.ts', "      strictImdbMatch: parseBoolean(pending.get('RADARR_STRICT_IMDB_MATCH'), config.radarr.strictImdbMatch)", "      strictImdbMatch: parseBoolean(pending.get('RADARR_STRICT_IMDB_MATCH'), config.radarr.strictImdbMatch),\n      existingItemPolicy: pendingValue(pending, 'RADARR_EXISTING_ITEM_POLICY', config.radarr.existingItemPolicy)")
replace_once('src/config-ui-core.ts', "      searchOnAdd: parseBoolean(pending.get('SONARR_SEARCH_ON_ADD'), config.sonarr.searchOnAdd)", "      searchOnAdd: parseBoolean(pending.get('SONARR_SEARCH_ON_ADD'), config.sonarr.searchOnAdd),\n      existingItemPolicy: pendingValue(pending, 'SONARR_EXISTING_ITEM_POLICY', config.sonarr.existingItemPolicy)")
replace_once('src/config-ui-core.ts', "  set('RADARR_STRICT_IMDB_MATCH', readBooleanField(radarr, 'strictImdbMatch', config.radarr.strictImdbMatch));", "  set('RADARR_STRICT_IMDB_MATCH', readBooleanField(radarr, 'strictImdbMatch', config.radarr.strictImdbMatch));\n  const radarrExistingPolicy = readStringField(radarr, 'existingItemPolicy', config.radarr.existingItemPolicy) as AppConfig['radarr']['existingItemPolicy'];\n  if (!EXISTING_ITEM_POLICIES.has(radarrExistingPolicy)) throw new Error('Invalid Radarr existing-item policy.');\n  set('RADARR_EXISTING_ITEM_POLICY', radarrExistingPolicy);")
replace_once('src/config-ui-core.ts', "  set('SONARR_SEARCH_ON_ADD', readBooleanField(sonarr, 'searchOnAdd', config.sonarr.searchOnAdd));", "  set('SONARR_SEARCH_ON_ADD', readBooleanField(sonarr, 'searchOnAdd', config.sonarr.searchOnAdd));\n  const sonarrExistingPolicy = readStringField(sonarr, 'existingItemPolicy', config.sonarr.existingItemPolicy) as AppConfig['sonarr']['existingItemPolicy'];\n  if (!EXISTING_ITEM_POLICIES.has(sonarrExistingPolicy)) throw new Error('Invalid Sonarr existing-item policy.');\n  set('SONARR_EXISTING_ITEM_POLICY', sonarrExistingPolicy);")
replace_once('src/config-ui-core.ts', "          <label for=\"radarr-strict\">Require strict IMDb match</label><select id=\"radarr-strict\" data-boolean-select=\"true\"><option value=\"true\">Enabled</option><option value=\"false\">Disabled</option></select>", "          <label for=\"radarr-strict\">Require strict IMDb match</label><select id=\"radarr-strict\" data-boolean-select=\"true\"><option value=\"true\">Enabled</option><option value=\"false\">Disabled</option></select>\n          <label for=\"radarr-existing-policy\">Existing movie settings</label>\n          <select id=\"radarr-existing-policy\"><option value=\"preserve\">Preserve existing settings (recommended)</option><option value=\"extend\">Preserve profile; allow monitoring extension</option><option value=\"apply-config\">Replace with these configured settings</option></select>\n          <p class=\"muted\">Preserve is safest. Apply-config can replace the movie profile, monitoring, root folder, tags and availability.</p>")
replace_once('src/config-ui-core.ts', "          <label for=\"sonarr-search\">Search immediately after add</label><select id=\"sonarr-search\" data-boolean-select=\"true\"><option value=\"true\">Enabled</option><option value=\"false\">Disabled</option></select>", "          <label for=\"sonarr-search\">Search immediately after add</label><select id=\"sonarr-search\" data-boolean-select=\"true\"><option value=\"true\">Enabled</option><option value=\"false\">Disabled</option></select>\n          <label for=\"sonarr-existing-policy\">Existing series settings</label>\n          <select id=\"sonarr-existing-policy\"><option value=\"preserve\">Preserve existing settings (recommended)</option><option value=\"extend\">Preserve profile; only extend selected monitoring</option><option value=\"apply-config\">Replace with these configured settings</option></select>\n          <p class=\"muted\">Preserve keeps the current profile, season/episode monitoring and new-item policy. Apply-config intentionally replaces them.</p>")
replace_once('assets/configure.js', "  setBooleanValue('radarr-strict', radarr.strictImdbMatch);", "  setBooleanValue('radarr-strict', radarr.strictImdbMatch);\n  byId('radarr-existing-policy').value = radarr.existingItemPolicy;")
replace_once('assets/configure.js', "  setBooleanValue('sonarr-search', sonarr.searchOnAdd);", "  setBooleanValue('sonarr-search', sonarr.searchOnAdd);\n  byId('sonarr-existing-policy').value = sonarr.existingItemPolicy;")
replace_once('assets/configure.js', "      strictImdbMatch: readBooleanValue('radarr-strict')", "      strictImdbMatch: readBooleanValue('radarr-strict'),\n      existingItemPolicy: byId('radarr-existing-policy').value")
replace_once('assets/configure.js', "      searchOnAdd: readBooleanValue('sonarr-search')", "      searchOnAdd: readBooleanValue('sonarr-search'),\n      existingItemPolicy: byId('sonarr-existing-policy').value")

# Test defaults and regression suite
replace_once('test/_helpers.ts', "      strictImdbMatch: false\n    },", "      strictImdbMatch: false,\n      existingItemPolicy: 'preserve'\n    },")
replace_once('test/_helpers.ts', "      searchOnAdd: true\n    },\n    traktSync:", "      searchOnAdd: true,\n      existingItemPolicy: 'preserve'\n    },\n    traktSync:")
sub_once(
    'test/radarr.test.ts',
    r"test\('triggerMovieSearch posts MoviesSearch command for existing movie'.*?\n\}\);\n\ntest\('queue failure",
    """test('triggerMovieSearch preserves an existing unmonitored profile and queues exact MoviesSearch', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.qualityProfileId = 1;
  cfg.radarr.existingItemPolicy = 'preserve';
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 5, imdbId: 'tt88', tmdbId: 88, monitored: false, qualityProfileId: 4, title: 'Movie 88' }] as T;
      if (path === '/api/v3/qualityprofile') return [{ id: 4, name: 'Existing P4' }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return { id: 101, name: 'MoviesSearch', status: 'queued' } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };
  const client = new RadarrClient(cfg, http as never);
  const result = await client.triggerMovieSearch('tt88');
  assert.equal(result.ok, true);
  assert.equal(result.commandId, 101);
  assert.deepEqual(calls, [{ path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [5] } }]);
  assert.match(result.detail ?? '', /preserved/i);
});

test('triggerMovieSearch rejects an invalid command acknowledgement', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/movie') return [{ id: 6, imdbId: 'tt89', monitored: true, title: 'Movie 89' }] as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(): Promise<T> { return {} as T; },
    async put<T>(): Promise<T> { return {} as T; }
  };
  const result = await new RadarrClient(cfg, http as never).triggerMovieSearch('tt89');
  assert.equal(result.ok, false);
  assert.match(result.title, /not accepted/i);
});

test('queue failure""",
)
write(
    'test/existing-item-policy.test.ts',
    r"""import test from 'node:test';
import assert from 'node:assert/strict';
import { SonarrClient } from '../src/services/sonarr.js';
import { baseConfig } from './_helpers.js';

test('existing Sonarr preserve policy keeps P4/all/new monitoring and queues exact episode search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.qualityProfileId = 1;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.existingItemPolicy = 'preserve';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{
        id: 22,
        imdbId: 'tt22',
        tvdbId: 222,
        title: 'SeriesXYZ',
        monitored: true,
        qualityProfileId: 4,
        monitorNewItems: 'all',
        seasons: [{ seasonNumber: 1, monitored: true }]
      }] as T;
      if (path === '/api/v3/episode?seriesId=22') return [{ id: 7, seasonNumber: 1, episodeNumber: 2, monitored: true }] as T;
      if (path === '/api/v3/qualityprofile') return [{ id: 4, name: 'Existing P4' }] as T;
      if (path.startsWith('/api/v3/queue?')) return { records: [] } as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'POST', path, body });
      return { id: 202, name: 'EpisodeSearch', status: 'queued' } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ method: 'PUT', path, body });
      return {} as T;
    }
  };

  const client = new SonarrClient(cfg, http as never);
  const result = await client.triggerEpisodeSearch('tt22', 1, 2);
  assert.equal(result.ok, true);
  assert.equal(result.commandId, 202);
  assert.deepEqual(calls, [{ method: 'POST', path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [7] } }]);
  assert.match(result.detail ?? '', /preserved/i);
});

test('existing unmonitored Sonarr episode remains unmonitored but exact search is queued', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'preserve';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const puts: unknown[] = [];
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 30, imdbId: 'tt30', title: 'Unmonitored', monitored: false, qualityProfileId: 4, monitorNewItems: 'none' }] as T;
      if (path === '/api/v3/episode?seriesId=30') return [{ id: 31, seasonNumber: 2, episodeNumber: 3, monitored: false }] as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body: unknown): Promise<T> { posts.push(body); return { id: 303 } as T; },
    async put<T>(_path: string, body: unknown): Promise<T> { puts.push(body); return {} as T; }
  };
  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt30', 2, 3);
  assert.equal(result.ok, true);
  assert.equal(puts.length, 0);
  assert.deepEqual(posts, [{ name: 'EpisodeSearch', episodeIds: [31] }]);
});

test('Sonarr exact episode timeout does not fall back to broad search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 4;
  const posts: unknown[] = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 40, imdbId: 'tt40', title: 'Not Ready' }] as T;
      if (path === '/api/v3/episode?seriesId=40') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(_path: string, body: unknown): Promise<T> { posts.push(body); return { id: 404 } as T; },
    async put<T>(): Promise<T> { return {} as T; }
  };
  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt40', 1, 1);
  assert.equal(result.ok, false);
  assert.equal(posts.length, 0);
  assert.match(result.summary, /No broad search was started/i);
});
""",
)

# Documentation
replace_once('.env.example', "#RADARR_STRICT_IMDB_MATCH=false\n", "#RADARR_STRICT_IMDB_MATCH=false\n# Existing movies default to preserving their current Radarr profile and monitoring.\n# preserve | extend | apply-config (destructive opt-in)\nRADARR_EXISTING_ITEM_POLICY=preserve\n")
replace_once('.env.example', "SONARR_SEARCH_ON_ADD=true\n", "SONARR_SEARCH_ON_ADD=true\n# Existing series default to preserving profile, season/episode monitoring and new-item policy.\n# preserve | extend | apply-config (destructive opt-in)\nSONARR_EXISTING_ITEM_POLICY=preserve\n")
replace_once('docs/CONFIGURATION.md', "| `RADARR_STRICT_IMDB_MATCH` | Requires a strict IMDb match before acting on an existing movie. |", "| `RADARR_STRICT_IMDB_MATCH` | Requires a strict IMDb match before acting on an existing movie. |\n| `RADARR_EXISTING_ITEM_POLICY` | Existing movie policy: `preserve` (default), `extend`, or destructive opt-in `apply-config`. Exact movie search still runs. |")
replace_once('docs/CONFIGURATION.md', "| `SONARR_SEARCH_ON_ADD` | Starts a search immediately after adding. |", "| `SONARR_SEARCH_ON_ADD` | Starts a search immediately after adding. |\n| `SONARR_EXISTING_ITEM_POLICY` | Existing series policy: `preserve` (default), `extend`, or destructive opt-in `apply-config`. Exact selected episode search still runs. |")
replace_once('docs/CONFIGURATION.md', "### Monitoring modes\n", "### Existing-item safety\n\nBy default, clicking a tile for an item already in Radarr/Sonarr preserves its existing quality profile and monitoring settings. The add-on independently queues a targeted `MoviesSearch` or exact `EpisodeSearch`, so preservation never makes the action a no-op. Use `extend` only to add minimal monitoring, or `apply-config` to intentionally replace existing Arr-managed settings.\n\n### Monitoring modes\n")
replace_once('CHANGELOG.md', "### Fixed\n\n", "### Fixed\n\n- Preserve existing Radarr/Sonarr profiles and monitoring by default while still queueing an exact movie/episode search for every action tile click.\n- Stop existing-series episode actions from unmonitoring unrelated episodes or falling back to broad season/missing searches.\n- Require valid Arr command acknowledgements before reporting a targeted search as queued.\n")
text = read('README.md')
marker = '## Configuration\n'
if marker in text and 'Existing Arr settings are preserved by default' not in text:
    text = text.replace(marker, "## Existing Arr settings\n\nExisting Arr settings are preserved by default. A tile click never overwrites an existing quality profile or monitoring scope merely to search: it queues an exact Radarr movie or Sonarr episode search independently. Advanced `extend` and `apply-config` policies are available in Configure for intentional changes.\n\n" + marker, 1)
    write('README.md', text)

print('Existing-item policy implementation patch applied.')
