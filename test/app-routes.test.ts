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

test('action GET always shows confirmation page regardless of actionConfirm flag', async () => {
  const cfg = baseConfig(); // actionConfirm=false
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/action/movie/tt1234567`);
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Confirm Add/);
    assert.match(html, /Back to Stremio/);
  });
});

test('action POST with disabled radarr shows failure page', async () => {
  const cfg = baseConfig(); // radarr disabled
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const res = await fetch(`${baseUrl}/action/movie/tt1234567`, { method: 'POST' });
    assert.equal(res.status, 200);
    const html = await res.text();
    assert.match(html, /Radarr unavailable/);
    assert.match(html, /Back to Stremio/);
  });
});

test('action route confirm flow requires POST side effect', async () => {
  const cfg = baseConfig();
  cfg.actionConfirm = true;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const path = new URL(url).pathname + (new URL(url).search || '');
    if (path === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (path === '/api/v3/movie') {
      if (init?.method === 'GET') return new Response('[]', { status: 200 });
      return new Response('{}', { status: 201 });
    }
    if (path.startsWith('/api/v3/movie/lookup/imdb')) {
      return new Response('[{"title":"Movie","imdbId":"tt1234567","tmdbId":100}]', { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const confirmRes = await ORIGINAL_FETCH(`${baseUrl}/action/movie/tt1234567`);
    const confirmHtml = await confirmRes.text();
    assert.match(confirmHtml, /Confirm Add \+ Search/);

    const executeRes = await ORIGINAL_FETCH(`${baseUrl}/action/movie/tt1234567`, { method: 'POST' });
    const executeHtml = await executeRes.text();
    assert.match(executeHtml, /Added to Radarr/);
  });
});
