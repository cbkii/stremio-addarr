import test from 'node:test';
import assert from 'node:assert/strict';
import { createLogger } from '../src/logger.js';
import { HttpError, HttpTimeoutError, JsonHttpClient } from '../src/lib/http.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function captureLogger() {
  const entries: Array<Record<string, unknown>> = [];
  const logger = createLogger('debug', {
    log: (line) => entries.push(JSON.parse(line) as Record<string, unknown>),
    error: (line) => entries.push(JSON.parse(line) as Record<string, unknown>)
  });
  return { logger, entries };
}

function client(logger = createLogger('none'), timeoutMs = 100): JsonHttpClient {
  return new JsonHttpClient({
    baseUrl: 'http://arr.test',
    apiKey: 'arr-secret',
    timeoutMs,
    logger,
    serviceName: 'radarr'
  });
}

test('JsonHttpClient GET sends API key and Accept headers and parses JSON', async () => {
  let observedUrl = '';
  let observedInit: RequestInit | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    observedUrl = String(input);
    observedInit = init;
    return new Response('{"ok":true,"count":2}', { status: 200 });
  }) as typeof fetch;

  const result = await client().get<{ ok: boolean; count: number }>('/api/v3/system/status');

  assert.deepEqual(result, { ok: true, count: 2 });
  assert.equal(observedUrl, 'http://arr.test/api/v3/system/status');
  assert.equal(observedInit?.method, 'GET');
  const headers = new Headers(observedInit?.headers);
  assert.equal(headers.get('X-Api-Key'), 'arr-secret');
  assert.equal(headers.get('Accept'), 'application/json');
});

test('JsonHttpClient POST and PUT send JSON bodies and preserve the authentication header', async () => {
  const requests: Array<{ url: string; method?: string; body?: BodyInit | null; headers: Headers }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    requests.push({
      url: String(input),
      method: init?.method,
      body: init?.body,
      headers: new Headers(init?.headers)
    });
    return new Response('{"id":7}', { status: 200 });
  }) as typeof fetch;

  const http = client();
  assert.deepEqual(await http.post('/api/v3/command', { name: 'MoviesSearch' }), { id: 7 });
  assert.deepEqual(await http.put('/api/v3/movie/editor', { movieIds: [1], monitored: true }), { id: 7 });

  assert.equal(requests.length, 2);
  assert.deepEqual(requests.map((request) => request.method), ['POST', 'PUT']);
  assert.ok(requests.every((request) => request.headers.get('X-Api-Key') === 'arr-secret'));
  assert.ok(requests.every((request) => request.headers.get('Content-Type') === 'application/json'));
  assert.equal(requests[0]?.body, JSON.stringify({ name: 'MoviesSearch' }));
  assert.equal(requests[1]?.body, JSON.stringify({ movieIds: [1], monitored: true }));
});

test('JsonHttpClient returns an empty object for a successful empty response', async () => {
  globalThis.fetch = (async () => new Response(null, { status: 204 })) as typeof fetch;
  assert.deepEqual(await client().post('/api/v3/command', {}), {});
});

test('JsonHttpClient exposes HTTP status/body and logs the expected error category', async () => {
  const cases = [
    { status: 401, category: 'auth_error' },
    { status: 403, category: 'auth_error' },
    { status: 404, category: 'not_found' },
    { status: 429, category: 'rate_limited' },
    { status: 500, category: 'server_error' }
  ];

  for (const { status, category } of cases) {
    const { logger, entries } = captureLogger();
    globalThis.fetch = (async () => new Response(`failure-${status}`, { status })) as typeof fetch;

    await assert.rejects(
      client(logger).get('/api/v3/test'),
      (error: unknown) => error instanceof HttpError
        && error.status === status
        && error.body === `failure-${status}`
    );

    assert.ok(entries.some((entry) => entry['message'] === 'arr response error'
      && entry['status'] === status
      && entry['errorCategory'] === category));
  }
});

test('JsonHttpClient converts AbortError into HttpTimeoutError and logs a timeout', async () => {
  const { logger, entries } = captureLogger();
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
    const rejectAbort = () => {
      const error = new Error('aborted');
      error.name = 'AbortError';
      reject(error);
    };
    if (init?.signal?.aborted) rejectAbort();
    else init?.signal?.addEventListener('abort', rejectAbort, { once: true });
  })) as typeof fetch;

  await assert.rejects(
    client(logger, 5).get('/api/v3/slow'),
    (error: unknown) => error instanceof HttpTimeoutError && /5ms/.test(error.message)
  );
  assert.ok(entries.some((entry) => entry['message'] === 'arr timeout' && entry['errorCategory'] === 'timeout'));
});

test('JsonHttpClient rethrows network failures and logs them without converting to HttpError', async () => {
  const { logger, entries } = captureLogger();
  const failure = new Error('connection refused');
  globalThis.fetch = (async () => { throw failure; }) as typeof fetch;

  await assert.rejects(client(logger).get('/api/v3/test'), (error: unknown) => error === failure);
  assert.ok(entries.some((entry) => entry['message'] === 'arr request failed'
    && entry['errorCategory'] === 'network'
    && entry['error'] === 'connection refused'));
});

test('JsonHttpClient supports a custom API key header', async () => {
  let observedHeaders = new Headers();
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    observedHeaders = new Headers(init?.headers);
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const http = new JsonHttpClient({
    baseUrl: 'http://arr.test',
    apiKey: 'custom-secret',
    apiKeyHeader: 'Authorization',
    timeoutMs: 100
  });
  await http.get('/api/v3/test');

  assert.equal(observedHeaders.get('Authorization'), 'custom-secret');
  assert.equal(observedHeaders.get('X-Api-Key'), null);
});
