import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';
import type { LogWriter } from '../src/logger.js';

/** Create a log writer that captures lines for assertion — no global mutation. */
function makeCapture(): { writer: LogWriter; stdout: string[]; stderr: string[] } {
  const stdout: string[] = [];
  const stderr: string[] = [];
  return {
    writer: {
      log: (s) => stdout.push(s),
      error: (s) => stderr.push(s)
    },
    stdout,
    stderr
  };
}

test('logger emits valid JSON with required fields', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('info', writer);
  logger.info('test message', { foo: 'bar' });
  assert.equal(stdout.length, 1);
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.ok(typeof parsed['time'] === 'string', 'should have time field');
  assert.equal(parsed['level'], 'info');
  assert.equal(parsed['message'], 'test message');
  assert.equal(parsed['foo'], 'bar');
});

test('logger writes errors to stderr', () => {
  const { writer, stdout, stderr } = makeCapture();
  const logger = createLogger('info', writer);
  logger.error('something broke', { detail: 'oops' });
  assert.equal(stdout.length, 0);
  assert.equal(stderr.length, 1);
  const parsed = JSON.parse(stderr[0]) as Record<string, unknown>;
  assert.equal(parsed['level'], 'error');
  assert.equal(parsed['message'], 'something broke');
});

test('logger respects log level threshold — debug suppressed at info level', () => {
  const { writer, stdout, stderr } = makeCapture();
  const logger = createLogger('info', writer);
  logger.debug('should be hidden');
  logger.info('should be visible');
  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 0);
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.equal(parsed['message'], 'should be visible');
});

test('logger at debug level emits debug messages', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('debug', writer);
  logger.debug('debug msg');
  logger.info('info msg');
  assert.equal(stdout.length, 2);
});

test('logger at warn level suppresses info and debug', () => {
  const { writer, stdout, stderr } = makeCapture();
  const logger = createLogger('warn', writer);
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.equal(stdout.length, 1);
  assert.equal(stderr.length, 1);
  const warnParsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.equal(warnParsed['level'], 'warn');
});

test('logger at none level suppresses all messages including errors', () => {
  const { writer, stdout, stderr } = makeCapture();
  const logger = createLogger('none', writer);
  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  assert.equal(stdout.length, 0);
  assert.equal(stderr.length, 0);
});

test('logger sanitizes apiKey fields in extra', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('info', writer);
  logger.info('check', { apiKey: 'secret123', nested: 'ok' });
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.equal(parsed['apiKey'], '[redacted]');
  assert.equal(parsed['nested'], 'ok');
});

test('logger sanitizes api_key variant', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('info', writer);
  logger.info('check', { api_key: 'topsecret' });
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.equal(parsed['api_key'], '[redacted]');
});

test('logger sanitizes URLs with embedded credentials', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('info', writer);
  logger.info('check', { baseUrl: 'http://user:pass@192.168.1.1:7878' });
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.ok(
    typeof parsed['baseUrl'] === 'string' && !String(parsed['baseUrl']).includes('pass'),
    'URL credentials should be redacted'
  );
});

test('logger does not alter non-sensitive fields', () => {
  const { writer, stdout } = makeCapture();
  const logger = createLogger('info', writer);
  logger.info('check', { imdbId: 'tt1234567', status: 'downloaded', count: 3 });
  const parsed = JSON.parse(stdout[0]) as Record<string, unknown>;
  assert.equal(parsed['imdbId'], 'tt1234567');
  assert.equal(parsed['status'], 'downloaded');
  assert.equal(parsed['count'], 3);
});
