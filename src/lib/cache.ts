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
