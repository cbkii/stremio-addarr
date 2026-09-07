import type { ExistingItemPolicy } from './config.js';

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
  externalUrl?: string;
  behaviorHints?: {
    notWebReady?: boolean;
    filename?: string;
    videoSize?: number;
    bingeGroup?: string;
  };
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
  releaseDate?: string;
  fileName?: string;
  fileSizeBytes?: number;
  reason?: string;
  qualityProfileId?: number;
  qualityProfileName?: string;
  existingItemPolicy?: ExistingItemPolicy;
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
  episodeReleaseDate?: string;
  fileName?: string;
  fileSizeBytes?: number;
  reason?: string;
  qualityProfileId?: number;
  qualityProfileName?: string;
  existingItemPolicy?: ExistingItemPolicy;
  seriesMonitored?: boolean;
  seasonMonitored?: boolean;
  monitorNewItems?: 'all' | 'none';
}

export interface AddActionResult {
  ok: boolean;
  service: ArrService;
  title: string;
  summary: string;
  detail?: string;
  alreadyExisted?: boolean;
  commandId?: number;
  itemId?: number;
}

export interface ArrCommandResponse {
  id?: number;
  name?: string;
  status?: string;
}

export interface ArrQualityProfile {
  id: number;
  name: string;
}

export interface ServiceHealth {
  configured: boolean;
  reachable: boolean;
  detail?: string;
}
