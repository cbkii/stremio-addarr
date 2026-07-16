export class SlidingWindowRateLimiter {
  private readonly entries = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly max: number, private readonly windowMs: number) {}

  isLimited(key: string, now = Date.now()): boolean {
    for (const [entryKey, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(entryKey);
    const current = this.entries.get(key);
    if (!current || current.resetAt <= now) {
      this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
      return false;
    }
    current.count += 1;
    return current.count > this.max;
  }
}
