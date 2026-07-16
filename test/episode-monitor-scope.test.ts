import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import { seriesMonitorScopeLine } from '../src/services/series-monitor-scope.js';
import { addonUrl, baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('Sonarr monitor settings have concise plain-English tile labels', () => {
  const expected: Array<[Parameters<typeof seriesMonitorScopeLine>[0], string]> = [
    ['all', '📡 Monitor scope: all episodes'],
    ['future', '📡 Monitor scope: future episodes'],
    ['missing', '📡 Monitor scope: missing episodes'],
    ['existing', '📡 Monitor scope: existing episodes'],
    ['firstSeason', '📡 Monitor scope: first season'],
    ['lastSeason', '📡 Monitor scope: last season'],
    ['latestSeason', '📡 Monitor scope: latest season'],
    ['pilot', '📡 Monitor scope: pilot only'],
    ['recent', '📡 Monitor scope: recent episodes'],
    ['monitorSpecials', '📡 Monitor scope: include specials'],
    ['unmonitorSpecials', '📡 Monitor scope: exclude specials'],
    ['none', '📡 Monitor scope: no episodes'],
    ['skip', '📡 Monitor scope: leave unchanged'],
    ['ep', '📡 Monitor scope: this episode only'],
    ['epfuture', '📡 Monitor scope: this + future episodes'],
    ['epseason', '📡 Monitor scope: this episode to season end']
  ];

  for (const [mode, label] of expected) {
    assert.equal(seriesMonitorScopeLine(mode), label);
  }
});

test('episode action tile explains the configured Sonarr monitoring scope', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epfuture';

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const parsed = new URL(String(input));
    const requestPath = parsed.pathname + parsed.search;
    if (requestPath === '/api/v3/system/status') return new Response('{}', { status: 200 });
    if (requestPath === '/api/v3/series') {
      return new Response('[{"id":10,"imdbId":"tt7654321","title":"Mock Show"}]', { status: 200 });
    }
    if (requestPath.startsWith('/api/v3/episode?seriesId=10')) {
      return new Response('[{"id":42,"seasonNumber":2,"episodeNumber":5,"monitored":true,"hasFile":false}]', { status: 200 });
    }
    if (requestPath.startsWith('/api/v3/queue?')) return new Response('{"records":[]}', { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/stream/series/tt7654321%3A2%3A5.json`);
    assert.equal(response.status, 200);
    const body = (await response.json()) as { streams: Array<{ description?: string }> };
    assert.ok(
      body.streams[0].description?.includes('📡 Monitor scope: this + future episodes'),
      'episode action tile should explain the configured monitoring scope'
    );
  });
});
