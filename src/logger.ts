export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(level: LogLevel) {
  const threshold = levelOrder[level] ?? levelOrder.info;

  function sanitize(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!extra) return undefined;
    return Object.fromEntries(
      Object.entries(extra).map(([key, value]) => {
        const normalized = key.toLowerCase();
        if (normalized.includes('apikey') || normalized.includes('api_key')) {
          return [key, '[redacted]'];
        }
        if (typeof value === 'string' && /^https?:\/\//.test(value)) {
          return [key, value.replace(/\/\/([^@/]+)@/g, '//[redacted]@')];
        }
        return [key, value];
      })
    );
  }

  function write(current: LogLevel, message: string, extra?: Record<string, unknown>) {
    if (levelOrder[current] < threshold) return;
    const line = {
      time: new Date().toISOString(),
      level: current,
      message,
      ...(sanitize(extra) ?? {})
    };
    const text = JSON.stringify(line);
    if (current === 'error') {
      console.error(text);
      return;
    }
    console.log(text);
  }

  return {
    debug: (message: string, extra?: Record<string, unknown>) => write('debug', message, extra),
    info: (message: string, extra?: Record<string, unknown>) => write('info', message, extra),
    warn: (message: string, extra?: Record<string, unknown>) => write('warn', message, extra),
    error: (message: string, extra?: Record<string, unknown>) => write('error', message, extra)
  };
}
