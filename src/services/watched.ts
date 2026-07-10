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
  areMoviesWatched?(imdbIds: readonly string[]): Promise<Map<string, boolean>>;
  isEpisodeWatched(imdbId: string, season?: number, episode?: number): Promise<boolean>;
  getDiagnostics?(): WatchedLookupDiagnostics;
}

export class NoopWatchedLookup implements WatchedLookup {
  async isMovieWatched(_imdbId: string): Promise<boolean> {
    return false;
  }

  async areMoviesWatched(imdbIds: readonly string[]): Promise<Map<string, boolean>> {
    const result = new Map<string, boolean>();
    if (imdbIds.length === 0) return result;
    for (const id of imdbIds) {
      result.set(id, false);
    }
    return result;
  }

  async isEpisodeWatched(_imdbId: string, _season?: number, _episode?: number): Promise<boolean> {
    return false;
  }

  getDiagnostics(): WatchedLookupDiagnostics {
    return { enabled: false, provider: 'noop' };
  }
}
