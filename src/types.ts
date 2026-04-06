export type ContentKind = 'movie' | 'series';

export interface ParsedStremioId {
  rawId: string;
  imdbId: string;
  kind: ContentKind;
  season?: number;
  episode?: number;
  videoId?: string;
}

export type ArrService = 'radarr' | 'sonarr';

export interface StatusTile {
  name: string;
  description?: string;
  url?: string;
  externalUris?: Array<{ uri: string; name?: string }>;
  behaviorHints?: { notWebReady?: boolean };
  isAction?: boolean;
}

export interface ArrMovieStatus {
  state: 'not_added' | 'added' | 'downloaded' | 'downloading' | 'missing' | 'unavailable';
  movieId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  reason?: string;
}

export interface ArrEpisodeStatus {
  state:
    | 'series_not_added'
    | 'series_added'
    | 'episode_monitored'
    | 'episode_downloaded'
    | 'episode_downloading'
    | 'episode_missing'
    | 'unavailable';
  seriesId?: number;
  episodeId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  reason?: string;
}

export interface AddActionResult {
  ok: boolean;
  service: ArrService;
  title: string;
  summary: string;
  detail?: string;
  alreadyExisted?: boolean;
}

export interface ServiceHealth {
  configured: boolean;
  reachable: boolean;
  detail?: string;
}

export interface RadarrMovieRecord {
  id: number;
  title: string;
  imdbId?: string;
  tmdbId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  movieFile?: { id: number } | null;
  year?: number;
}

export interface RadarrLookupRecord {
  title: string;
  imdbId?: string;
  tmdbId: number;
  year?: number;
}

export interface SonarrSeriesRecord {
  id: number;
  title: string;
  imdbId?: string;
  tvdbId?: number;
  monitored?: boolean;
  statistics?: {
    episodeFileCount?: number;
    episodeCount?: number;
    totalEpisodeCount?: number;
  };
}

export interface SonarrEpisodeRecord {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  monitored?: boolean;
  hasFile?: boolean;
  episodeFileId?: number;
}

export interface SonarrLookupRecord {
  title: string;
  year?: number;
  imdbId?: string;
  tvdbId?: number;
}

export interface ConfigValidation {
  issues: string[];
  isHttps: boolean;
  targetClient: 'android-tv' | 'generic';
  isHostnameIp: boolean;
  isInternalHostname: boolean;
  hasPathPrefix: boolean;
  likelyAndroidTvCompatible: boolean;
  recommendedCaddyPublicCert: boolean;
}
