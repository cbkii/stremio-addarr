export type FilePathCacheSource = 'hit' | 'miss' | 'deduped';

interface Entry {
  value: string;
  expiresAt: number;
}

/**
 * Small async TTL cache for Arr file-id -> path resolution.
 *
 * Media players may issue many Range requests for one file. Resolving the same
 * stable Arr file ID for every byte-range request unnecessarily couples the
 * media data path to the Arr control plane. Concurrent misses are collapsed,
 * null results are not cached, and callers can invalidate a stale path after a
 * filesystem miss.
 */
export class FilePathResolverCache {
  private readonly entries = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<string | null>>();

  constructor(private readonly ttlMs: number) {}

  async getOrResolve(
    key: string,
    resolver: () => Promise<string | null>,
    now = Date.now()
  ): Promise<{ value: string | null; source: FilePathCacheSource }> {
    const entry = this.entries.get(key);
    if (entry && now < entry.expiresAt) {
      return { value: entry.value, source: 'hit' };
    }
    if (entry) this.entries.delete(key);

    const pending = this.inFlight.get(key);
    if (pending) {
      return { value: await pending, source: 'deduped' };
    }

    const promise = resolver();
    this.inFlight.set(key, promise);
    try {
      const value = await promise;
      if (value) {
        this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
      }
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
}
