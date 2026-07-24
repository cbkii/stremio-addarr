import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { baseConfig, signedActionUrl, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

/** Race a promise against a 5 s timeout, failing fast if the background op never fires. */
function withCommandTimeout(p: Promise<void>): Promise<void> {
  return Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('timed out waiting for background command POST')), 5000)
    )
  ]);
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('health route exposes version and service config', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { version: string; services: { radarr: { configured: boolean } } };
    assert.equal(body.version, '0.1.0-test');
    assert.equal(body.services.radarr.configured, false);
  });
});

test('/healthz returns {ok:true} with status 200', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/healthz`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as { ok: boolean };
    assert.equal(body.ok, true);
  });
});

test('/status.json returns structured JSON with expected fields', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = false;
  cfg.sonarr.enabled = false;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/status.json`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.ok('name' in body);
    assert.ok('version' in body);
    assert.ok('publicBaseUrl' in body);
    assert.ok('publicBaseUrlIsHttps' in body);
    assert.ok('serviceHealthCacheTtlMs' in body);
    assert.ok('streamCacheMaxAge' in body);
    assert.ok('streamStaleRevalidate' in body);
    assert.ok('radarr' in body);
    assert.ok('sonarr' in body);
    assert.ok('configIssues' in body);
    assert.ok(Array.isArray(body.configIssues));
  });
});

test('/status.json does not contain API keys in response', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/status.json`);
    const text = await res.text();
    assert.ok(!text.includes('radarr-key'), 'Should not expose radarr API key');
    assert.ok(!text.includes('sonarr-key'), 'Should not expose sonarr API key');
  });
});

test('root route returns tiny operator text only', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/`);
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.equal(text, 'stremio-addarr ok\n');
    assert.ok(!text.includes('radarr-key'), 'Should not expose radarr API key');
    assert.ok(!text.includes('sonarr-key'), 'Should not expose sonarr API key');
  });
});


test('assets logo is served from local repo static path', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/assets/logo.png`);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type') ?? '', /image\/png/);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('cross-origin-resource-policy'), 'cross-origin');
    const body = await res.text();
    assert.ok(body.length > 0);
  });
});

test('search action route triggers Radarr search and returns HLS stream', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const called: Array<{ path: string; method: string }> = [];

  let resolveCommandPosted: () => void = () => {};
  const commandPosted = new Promise<void>((resolve) => { resolveCommandPosted = resolve; });

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');
    called.push({ path, method: init?.method ?? 'GET' });

    if (path === '/api/v3/movie' && (init?.method === 'GET' || !init?.method)) {
      return new Response('[{"id":100,"imdbId":"tt1234567","monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) {
      return new Response('{"records":[]}', { status: 200 });
    }
    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{"id":1001,"name":"MoviesSearch","status":"queued"}', { status: 201 });
    }
    if (path === '/api/v3/system/status') {
      return new Response('{}', { status: 200 });
    }

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedActionUrl(baseUrl, cfg, 'search', 'movie', 'tt1234567'));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('#EXTM3U'), 'Should return an HLS playlist');

    // The action responds immediately; Arr operations run in the background.
    // Use withCommandTimeout so the test fails fast on regression instead of hanging CI.
    await withCommandTimeout(commandPosted);
    assert.ok(called.some((entry) => entry.path === '/api/v3/command' && entry.method === 'POST'));
  });
});

test('add-search action route performs add and search on Sonarr', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  // resolveCommandPosted is initialized to a no-op; the Promise constructor
  // always runs synchronously and replaces it with the real resolver.
  let resolveCommandPosted: () => void = () => {};
  const commandPosted = new Promise<void>((resolve) => { resolveCommandPosted = resolve; });

  // After POST /api/v3/series the mock must reflect the added series so that the
  // subsequent triggerSearch → findSeriesByImdbId call (on the cleared cache)
  // succeeds and proceeds to post the search command.
  let seriesAdded = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');

    if (path === '/api/v3/series' && (init?.method === 'GET' || !init?.method)) {
      const list = seriesAdded
        ? '[{"id":777,"imdbId":"tt7654321","tvdbId":777,"monitored":true,"title":"Show"}]'
        : '[]';
      return new Response(list, { status: 200 });
    }
    if (path.startsWith('/api/v3/series/lookup?term=')) {
      return new Response('[{"title":"Show","imdbId":"tt7654321","tvdbId":777}]', { status: 200 });
    }
    if (path === '/api/v3/series' && init?.method === 'POST') {
      seriesAdded = true;
      return new Response('{}', { status: 201 });
    }
    if (path.startsWith('/api/v3/episode?seriesId=')) {
      return new Response('[{"id":45,"seasonNumber":2,"episodeNumber":5,"monitored":true}]', { status: 200 });
    }
    if (path.startsWith('/api/v3/queue?')) {
      return new Response('{"records":[]}', { status: 200 });
    }
    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{"id":2001,"name":"EpisodeSearch","status":"queued"}', { status: 201 });
    }
    if (path === '/api/v3/system/status') {
      return new Response('{}', { status: 200 });
    }

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt7654321:2:5'));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('#EXTM3U'), 'Should return an HLS playlist');

    // The action responds immediately; wait for background Arr ops to finish
    // before the test ends and afterEach restores globalThis.fetch.
    await withCommandTimeout(commandPosted);
  });
});


test('series add-search action route triggers Sonarr add and search', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  // resolveCommandPosted is initialized to a no-op; the Promise constructor
  // always runs synchronously and replaces it with the real resolver.
  let resolveCommandPosted: () => void = () => {};
  const commandPosted = new Promise<void>((resolve) => { resolveCommandPosted = resolve; });

  // After POST /api/v3/series the mock must reflect the added series so that the
  // subsequent triggerSearch → findSeriesByImdbId call (on the cleared cache)
  // succeeds and proceeds to post the search command.
  let seriesAdded = false;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');

    if (path === '/api/v3/series' && (init?.method === 'GET' || !init?.method)) {
      const list = seriesAdded
        ? '[{"id":111,"imdbId":"tt1111111","tvdbId":111,"monitored":true,"title":"Show"}]'
        : '[]';
      return new Response(list, { status: 200 });
    }
    if (path.startsWith('/api/v3/series/lookup?term=')) return new Response('[{"title":"Show","imdbId":"tt1111111","tvdbId":111}]', { status: 200 });
    if (path === '/api/v3/series' && init?.method === 'POST') {
      seriesAdded = true;
      return new Response('{}', { status: 201 });
    }
    if (path.startsWith('/api/v3/episode?seriesId=111')) return new Response('[{"id":112,"seasonNumber":1,"episodeNumber":1,"monitored":true}]', { status: 200 });
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    if (path === '/api/v3/command' && init?.method === 'POST') {
      resolveCommandPosted();
      return new Response('{"id":3001,"name":"EpisodeSearch","status":"queued"}', { status: 201 });
    }

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt1111111:1:1'));
    assert.equal(res.status, 200);
    const text = await res.text();
    assert.ok(text.includes('#EXTM3U'), 'Should return an HLS playlist');

    // The action responds immediately; wait for background Arr ops to finish
    // before the test ends and afterEach restores globalThis.fetch.
    await withCommandTimeout(commandPosted);
  });
});
