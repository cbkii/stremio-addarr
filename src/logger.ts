export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';
export type Logger = ReturnType<typeof createLogger>;
export interface LogWriter { log(s: string): void; error(s: string): void; }

const levelOrder: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, none: 50 };
const sensitiveFragments = ['apikey', 'api_key', 'secret', 'token', 'password', 'authorization', 'cookie', 'x-api-key'];
const sensitiveQuery = new Set(['token', 'key', 'apikey', 'api_key', 'signature', 'sig', 'password']);

function sanitiseUrl(value: string): string {
  try {
    const url = new URL(value);
    if (url.username || url.password) { url.username = '[redacted]'; url.password = '[redacted]'; }
    for (const key of [...url.searchParams.keys()]) if (sensitiveQuery.has(key.toLowerCase())) url.searchParams.set(key, '[redacted]');
    return url.toString();
  } catch { return value.replace(/\/\/([^@/]+)@/g, '//[redacted]@'); }
}

function sanitise(value: unknown, key = '', depth = 0, seen = new WeakSet<object>()): unknown {
  const normalised = key.toLowerCase();
  if (sensitiveFragments.some((fragment) => normalised.includes(fragment))) return '[redacted]';
  if (typeof value === 'string') return /^https?:\/\//i.test(value) ? sanitiseUrl(value) : value;
  if (value == null || typeof value !== 'object' || depth >= 5) return value;
  if (seen.has(value)) return '[circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitise(item, '', depth + 1, seen));
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [childKey, sanitise(child, childKey, depth + 1, seen)]));
}

export function createLogger(level: LogLevel, writer?: LogWriter) {
  const threshold = levelOrder[level] ?? levelOrder.info;
  const out: LogWriter = writer ?? { log: (s) => console.log(s), error: (s) => console.error(s) };
  function write(current: LogLevel, message: string, extra?: Record<string, unknown>) {
    if (levelOrder[current] < threshold) return;
    const safe = extra ? sanitise(extra) as Record<string, unknown> : undefined;
    const text = JSON.stringify({ time: new Date().toISOString(), level: current, message, ...(safe ?? {}) });
    current === 'error' ? out.error(text) : out.log(text);
  }
  return {
    debug: (message: string, extra?: Record<string, unknown>) => write('debug', message, extra),
    info: (message: string, extra?: Record<string, unknown>) => write('info', message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => write('warn', message, extra),
    error: (message: string, extra?: Record<string, unknown>) => write('error', message, extra)
  };
}
