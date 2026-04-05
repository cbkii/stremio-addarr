import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

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

test('action route performs add on GET and immediately returns to Stremio detail link', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');

    if (path === '/api/v3/movie') {
      if (init?.method === 'GET' || !init?.method) return new Response('[]', { status: 200 });
      return new Response('{}', { status: 201 });
    }
    if (path.startsWith('/api/v3/movie/lookup/imdb')) {
      return new Response('[{"title":"Movie","imdbId":"tt1234567","tmdbId":100}]', { status: 200 });
    }
    if (path === '/api/v3/system/status') {
      return new Response('{}', { status: 200 });
    }

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${baseUrl}/action/movie/tt1234567`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'stremio:///detail/movie/tt1234567/tt1234567');

    const html = await res.text();
    assert.match(html, /Return to Stremio/);
    assert.match(html, /Added to Radarr/);
  });
});

test('action route preserves exact episode detail link context on return', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');

    if (path === '/api/v3/series' && (init?.method === 'GET' || !init?.method)) {
      return new Response('[]', { status: 200 });
    }
    if (path.startsWith('/api/v3/series/lookup?term=')) {
      return new Response('[{"title":"Show","imdbId":"tt7654321","tvdbId":777}]', { status: 200 });
    }
    if (path === '/api/v3/series' && init?.method === 'POST') {
      return new Response('{}', { status: 201 });
    }
    if (path === '/api/v3/system/status') {
      return new Response('{}', { status: 200 });
    }

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const encoded = encodeURIComponent('tt7654321:2:5');
    const res = await ORIGINAL_FETCH(`${baseUrl}/action/series/${encoded}`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'stremio:///detail/series/tt7654321/tt7654321:2:5');
  });
});


test('series action return link without episode preserves series detail context', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const parsed = new URL(url);
    const path = parsed.pathname + (parsed.search || '');

    if (path === '/api/v3/series' && (init?.method === 'GET' || !init?.method)) return new Response('[]', { status: 200 });
    if (path.startsWith('/api/v3/series/lookup?term=')) return new Response('[{"title":"Show","imdbId":"tt1111111","tvdbId":111}]', { status: 200 });
    if (path === '/api/v3/series' && init?.method === 'POST') return new Response('{}', { status: 201 });

    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const res = await ORIGINAL_FETCH(`${baseUrl}/action/series/tt1111111`, { redirect: 'manual' });
    assert.equal(res.status, 303);
    assert.equal(res.headers.get('location'), 'stremio:///detail/series/tt1111111/tt1111111');
  });
});
