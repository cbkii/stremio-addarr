export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const levelOrder: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40
};

export function createLogger(level: LogLevel) {
  const threshold = levelOrder[level] ?? levelOrder.info;

  function write(current: LogLevel, message: string, extra?: Record<string, unknown>) {
    if (levelOrder[current] < threshold) return;
    const line = {
      time: new Date().toISOString(),
      level: current,
      message,
      ...(extra ?? {})
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
