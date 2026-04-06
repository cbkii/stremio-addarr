import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manifest endpoint shape sanity', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/manifest.json`);
    assert.equal(response.status, 200);
    const manifest = (await response.json()) as {
      resources: string[];
      types: string[];
      idPrefixes: string[];
    };
    assert.deepEqual(manifest.resources, ['stream']);
    assert.deepEqual(manifest.types, ['movie', 'series']);
    assert.deepEqual(manifest.idPrefixes, ['tt']);
  });
});

test('downloaded tile launches Kodi via externalUris when enabled', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname + new URL(String(input)).search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","hasFile":true,"monitored":true}]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; externalUris?: Array<{ uri: string }> }> };
    assert.equal(body.streams[0].name, '✅ Downloaded');
    assert.match(body.streams[0].externalUris?.[0].uri ?? '', /package=org.xbmc.kodi/);
  });
});

test('downloaded tile has no externalUris when Kodi is disabled', async () => {
  const cfg = baseConfig();
  cfg.kodi.enabled = false;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const path = new URL(String(input)).pathname;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","hasFile":true,"monitored":true}]', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ externalUris?: Array<{ uri: string }> }> };
    assert.equal(body.streams[0].externalUris?.length ?? 0, 0);
  });
});

test('missing movie tile triggers search action URL and does not expose secrets', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const path = parsed.pathname + parsed.search;
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') return new Response('[{"id":9,"imdbId":"tt1234567","hasFile":false,"monitored":true}]', { status: 200 });
    if (path.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    const body = (await response.json()) as { streams: Array<{ name: string; url?: string }> };
    assert.equal(body.streams[0].name, '⭕🔍 Search on Radarr');
    assert.equal(body.streams[0].url, 'https://stremio-addarr.lan/action/search/movie/tt1234567');

    const serialized = JSON.stringify(body);
    assert.ok(!serialized.includes('radarr-key'));
    assert.ok(!serialized.includes('sonarr-key'));
  });
});

test('stream cache hints are driven by config values', async () => {
  const cfg = baseConfig();
  cfg.streamCacheMaxAgeSec = 7;
  cfg.streamStaleRevalidateSec = 11;
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { cacheMaxAge: number; staleRevalidate: number };
    assert.equal(body.cacheMaxAge, 7);
    assert.equal(body.staleRevalidate, 11);
  });
});
