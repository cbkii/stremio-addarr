export interface WatchedLookupDiagnostics {
  enabled: boolean;
  provider: 'noop' | 'trakt';
  syncMins?: number;
  lastSyncAt?: string;
  nextSyncAt?: string;
  lastSyncError?: string;
}

export interface WatchedLookup {
  isMovieWatched(imdbId: string): Promise<boolean>;
  isEpisodeWatched(imdbId: string, season?: number, episode?: number): Promise<boolean>;
  getDiagnostics?(): WatchedLookupDiagnostics;
}

export class NoopWatchedLookup implements WatchedLookup {
  async isMovieWatched(_imdbId: string): Promise<boolean> {
    return false;
  }

  async isEpisodeWatched(_imdbId: string, _season?: number, _episode?: number): Promise<boolean> {
    return false;
  }

  getDiagnostics(): WatchedLookupDiagnostics {
    return { enabled: false, provider: 'noop' };
  }
}
