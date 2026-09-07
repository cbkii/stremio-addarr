export type FilePathCacheSource = 'hit' | 'miss' | 'deduped';

interface Entry {
  value: string;
  expiresAt: number;
}

const DEFAULT_MAX_ENTRIES = 1024;

/**
 * Small bounded async TTL cache for Arr file-id -> path resolution.
 *
 * Media players may issue many Range requests for one file. Resolving the same
 * stable Arr file ID for every byte-range request unnecessarily couples the
 * media data path to the Arr control plane. Concurrent misses are collapsed,
 * null results are not cached, and callers can invalidate a stale path after a
 * filesystem miss.
 *
 * Successful hits use sliding expiry so an actively used/new playback session
 * does not inherit only the remainder of an older entry's TTL. Entries are kept
 * in least-recently-used order and bounded to prevent stale file IDs from
 * accumulating indefinitely in a long-running service.
 */
export class FilePathResolverCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();
  private readonly maxEntries: number;

  constructor(
    private readonly ttlMs: number,
    maxEntries = DEFAULT_MAX_ENTRIES,
    private readonly now: () => number = Date.now
  ) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  async getOrResolve(
    key: string,
    resolver: () => Promise<string | null>,
    now = this.now()
  ): Promise<{ value: string | null; source: FilePathCacheSource }> {
    this.pruneExpired(now);

    const entry = this.entries.get(key);
    if (entry) {
      this.touch(key, entry.value, now);
      return { value: entry.value, source: 'hit' };
    }

    const pending = this.inFlight.get(key);
    if (pending) {
      const value = await pending;
      const resolvedEntry = value ? this.entries.get(key) : undefined;
      if (resolvedEntry) this.touch(key, resolvedEntry.value, now);
      return { value, source: 'deduped' };
    }

    const promise = resolver();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      if (value) this.store(key, value, now);
      return { value, source: 'miss' };
    } finally {
      if (this.inFlight.get(key) === promise) this.inFlight.delete(key);
    }
  }

  invalidate(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
    this.inFlight.clear();
  }

  private pruneExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  private touch(key: string, value: string, now: number): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }

  private store(key: string, value: string, now: number): void {
    this.pruneExpired(now);
    this.entries.delete(key);

    while (this.entries.size >= this.maxEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }

    this.entries.set(key, { value, expiresAt: now + this.ttlMs });
  }
}
