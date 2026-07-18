import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/index.js';
import {
  seriesMonitorScopeLabels,
  seriesMonitorScopeLine
} from '../src/services/series-monitor-scope.js';
import { addonUrl, baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

function monitorConfig(overrides: Partial<ReturnType<typeof baseConfig>['sonarr']> = {}) {
  return { ...baseConfig().sonarr, ...overrides };
}

test('Sonarr monitor settings use compact single-line scope labels', () => {
  const expected: Array<[
    ReturnType<typeof baseConfig>['sonarr']['seriesMonitor'],
    string,
    string
  ]> = [
    ['all', 'all eps', '✅new'],
    ['future', 'future eps', '✅new'],
    ['missing', 'missing eps', '✅new'],
    ['existing', 'existing eps', '✅new'],
    ['firstSeason', 'first season', '✅new'],
    ['lastSeason', 'last season', '✅new'],
    ['latestSeason', 'latest season', '✅new'],
    ['pilot', 'pilot only', '✅new'],
    ['recent', 'recent eps', '✅new'],
    ['monitorSpecials', 'include specials', '✅new'],
    ['unmonitorSpecials', 'exclude specials', '✅new'],
    ['none', 'no eps', '✅new'],
    ['skip', 'leave unchanged', '✅new'],
    ['ep', 'this', '❌new'],
    ['epfuture', '+future', '✅new'],
    ['epseason', 'this to season end', '❌new']
  ];

  for (const [seriesMonitor, scope, newItems] of expected) {
    const line = seriesMonitorScopeLine(monitorConfig({ seriesMonitor, monitorNewItems: 'auto', epCount: 0 }));
    assert.equal(line, `📡: ${scope} ${newItems}`);
    assert.ok(!line.includes('\n'));
    assert.ok(!line.includes('episode'));
    assert.ok(!line.includes('auto'));
    assert.ok(!line.includes(' · '));
    assert.ok(!line.includes('new eps:'));
  }
});

test('explicit new-item settings are described by outcome', () => {
  assert.equal(
    seriesMonitorScopeLine(monitorConfig({ seriesMonitor: 'epseason', monitorNewItems: 'all' })),
    '📡: this to season end ✅new'
  );
  assert.equal(
    seriesMonitorScopeLine(monitorConfig({ seriesMonitor: 'epfuture', monitorNewItems: 'none' })),
    '📡: +future ❌new'
  );
});

test('all applicable ep-scope modifiers fit on one tile line', () => {
  const config = monitorConfig({
    seriesMonitor: 'ep',
    monitorNewItems: 'auto',
    epCount: 3,
    epCountPast: 8,
    epCountMod: 'epfuture'
  });

  assert.deepEqual(seriesMonitorScopeLabels(config), [
    'this',
    '(⥸3 / ⎗8 = +future)',
    '❌new→✅new'
  ]);
  assert.equal(
    seriesMonitorScopeLine(config),
    '📡: this (⥸3 / ⎗8 = +future) ❌new→✅new'
  );
  assert.ok(!seriesMonitorScopeLine(config).includes('\n'));
  assert.ok(!seriesMonitorScopeLine(config).includes(' · '));
});

test('auto remains off when ep upgrades only to season end', () => {
  const config = monitorConfig({
    seriesMonitor: 'ep',
    monitorNewItems: 'auto',
    epCount: 3,
    epCountPast: 8,
    epCountMod: 'epseason'
  });

  assert.equal(
    seriesMonitorScopeLine(config),
    '📡: this (⥸3 / ⎗8 = season end) ❌new'
  );
});

test('disabled ep auto-upgrade settings do not add an inapplicable label', () => {
  const config = monitorConfig({
    seriesMonitor: 'ep',
    monitorNewItems: 'auto',
    epCount: 1,
    epCountPast: 12,
    epCountMod: 'epseason'
  });

  assert.equal(seriesMonitorScopeLine(config), '📡: this ❌new');
});

test('episode action tile shows every applicable scope label on one line', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.monitorNewItems = 'auto';
  cfg.sonarr.epCount = 3;
  cfg.sonarr.epCountPast = 8;
  cfg.sonarr.epCountMod = 'epfuture';

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
    const lines = body.streams[0].description?.split('\n') ?? [];
    assert.ok(lines.includes('📡: this (⥸3 / ⎗8 = +future) ❌new→✅new'));
    assert.equal(lines.filter((line) => line.startsWith('📡:')).length, 1);
  });
});
