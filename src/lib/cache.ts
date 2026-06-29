export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expiresAt: number }>();

  constructor(private readonly ttlMs: number) {}

  get(key: string): T | undefined {
    const item = this.entries.get(key);
    if (!item) return undefined;
    if (Date.now() >= item.expiresAt) {
      this.entries.delete(key);
      return undefined;
    }
    return item.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.entries.clear();
  }
}

export class AsyncTtlCache<T> {
  private readonly cache: TtlCache<T>;
  private readonly inFlight = new Map<string, Promise<T>>();

  constructor(ttlMs: number) {
    this.cache = new TtlCache<T>(ttlMs);
  }

  async getOrSet(key: string, factory: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached !== undefined) {
      return cached;
    }

    const existingInFlight = this.inFlight.get(key);
    if (existingInFlight) {
      return existingInFlight;
    }

    const promise = factory().then((value) => {
      if (this.inFlight.get(key) === promise) {
        this.cache.set(key, value);
        this.inFlight.delete(key);
      }
      return value;
    }).catch((err) => {
      if (this.inFlight.get(key) === promise) {
        this.inFlight.delete(key);
      }
      throw err;
    });

    this.inFlight.set(key, promise);
    return promise;
  }

  clear(): void {
    this.cache.clear();
    this.inFlight.clear();
  }
}
