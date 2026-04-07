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
  behaviorHints?: { notWebReady?: boolean; filename?: string; videoSize?: number };
  isAction?: boolean;
}

export interface ArrMovieStatus {
  state: 'not_added' | 'added' | 'downloaded' | 'downloading' | 'missing' | 'unavailable';
  movieId?: number;
  movieFileId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  title?: string;
  year?: number;
  fileName?: string;
  fileSizeBytes?: number;
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
  episodeFileId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  title?: string;
  fileName?: string;
  fileSizeBytes?: number;
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

export interface ArrImageRecord {
  coverType?: string;
  url?: string;
  remoteUrl?: string;
}

export interface RadarrMovieRecord {
  id: number;
  title: string;
  imdbId?: string;
  tmdbId?: number;
  monitored?: boolean;
  hasFile?: boolean;
  movieFile?: { id: number; relativePath?: string; size?: number; path?: string } | null;
  year?: number;
  images?: ArrImageRecord[];
}

export interface RadarrLookupRecord {
  title: string;
  imdbId?: string;
  tmdbId: number;
  year?: number;
}

export interface RadarrHistoryRecord {
  id?: number;
  movieId?: number;
  date?: string;
  eventType?: string;
  sourceTitle?: string;
  quality?: { quality?: { name?: string } };
}

export interface RadarrQueueRecord {
  id?: number;
  movieId?: number;
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  estimatedCompletionTime?: string;
  timeleft?: string;
  sizeleft?: number;
  size?: number;
  outputPath?: string;
  protocol?: string;
  quality?: { quality?: { name?: string } };
}

export interface SonarrSeriesRecord {
  id: number;
  title: string;
  imdbId?: string;
  tvdbId?: number;
  year?: number;
  monitored?: boolean;
  images?: ArrImageRecord[];
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
  episodeFile?: { relativePath?: string; size?: number; path?: string };
}

export interface SonarrLookupRecord {
  title: string;
  year?: number;
  imdbId?: string;
  tvdbId?: number;
}

export interface SonarrHistoryRecord {
  id?: number;
  seriesId?: number;
  episodeId?: number;
  date?: string;
  eventType?: string;
  sourceTitle?: string;
  episode?: { seasonNumber?: number; episodeNumber?: number };
  quality?: { quality?: { name?: string } };
}

export interface SonarrQueueRecord {
  id?: number;
  seriesId?: number;
  episodeId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  title?: string;
  status?: string;
  trackedDownloadStatus?: string;
  trackedDownloadState?: string;
  statusMessages?: Array<{ title?: string; messages?: string[] }>;
  estimatedCompletionTime?: string;
  timeleft?: string;
  sizeleft?: number;
  size?: number;
  protocol?: string;
  quality?: { quality?: { name?: string } };
}

export interface CatalogItem {
  source: 'radarr' | 'sonarr';
  status: 'downloading' | 'imported';
  type: 'movie' | 'series';
  imdbId: string;
  title: string;
  poster: string;
  posterShape: 'poster';
  releaseInfo: string;
  description?: string;
  timestamp: number;
  progressPct?: number;
  etaSeconds?: number;
  stalled?: boolean;
  seasonNumber?: number;
  episodeNumber?: number;
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
