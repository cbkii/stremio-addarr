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

test('stream handler returns no tiles when both services are disabled', async () => {
  const app = createApp(baseConfig());
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { streams: Array<{ name: string }> };
    assert.equal(body.streams.length, 0);
  });
});

test('stream handler returns no tiles when both services are unreachable', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.sonarr.enabled = true;

  globalThis.fetch = (async () => {
    throw new TypeError('fetch failed');
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { streams: Array<{ name: string }> };
    assert.equal(body.streams.length, 0);
  });
});

test('stream action URL is deterministic and does not leak API keys', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path === '/api/v3/system/status') {
      return new Response('{}', { status: 200 });
    }
    if (path === '/api/v3/movie') {
      return new Response('[]', { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/stream/movie/tt1234567.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { streams: Array<{ externalUrl?: string }> };
    assert.equal(body.streams[0].externalUrl, 'https://stremio-addarr.lan/action/movie/tt1234567');

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
