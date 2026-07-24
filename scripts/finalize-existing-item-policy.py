from __future__ import annotations

import re
from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    Path(path).write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old[:120]!r}')
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex occurrence, found {count}: {pattern[:140]!r}')
    write(path, updated)


# Carry newly created Arr IDs into the exact-search phase.
replace_once(
    'src/types.ts',
    "  commandId?: number;\n}",
    "  commandId?: number;\n  itemId?: number;\n}",
)

# Radarr: preserve existing IDs, use POST-returned ID for new items, and remove
# the old release-grab path now that every action has one exact command contract.
replace_once('src/services/radarr.ts', "  RadarrReleaseRecord,\n", '')
replace_once(
    'src/services/radarr.ts',
    "        detail: `${existing.title}${profile ? ` · ${profile}` : ''}`,\n        alreadyExisted: true",
    "        detail: `${existing.title}${profile ? ` · ${profile}` : ''}`,\n        alreadyExisted: true,\n        itemId: existing.id",
)
replace_once(
    'src/services/radarr.ts',
    "    try {\n      await this.http.post('/api/v3/movie', payload);\n    } catch (error) {",
    "    let created: RadarrMovieRecord;\n    try {\n      created = await this.http.post<RadarrMovieRecord>('/api/v3/movie', payload);\n    } catch (error) {",
)
replace_once(
    'src/services/radarr.ts',
    "      summary: 'Movie added.',\n      detail: match.title",
    "      summary: 'Movie added.',\n      detail: match.title,\n      itemId: created.id",
)
replace_once(
    'src/services/radarr.ts',
    "    options: { existingBeforeAction?: boolean } = { existingBeforeAction: true }\n  ): Promise<AddActionResult> {\n    this.logger.info('radarr search start', { imdbId });\n    let existing: RadarrMovieRecord | undefined;\n    try {\n      existing = await this.findMovieByImdbId(imdbId, true);\n    } catch (error) {",
    "    options: { existingBeforeAction?: boolean; knownMovieId?: number; knownTitle?: string } = { existingBeforeAction: true }\n  ): Promise<AddActionResult> {\n    this.logger.info('radarr search start', { imdbId });\n    let existing: RadarrMovieRecord | undefined = options.knownMovieId != null\n      ? { id: options.knownMovieId, imdbId, title: options.knownTitle ?? imdbId }\n      : undefined;\n    try {\n      existing ??= await this.findMovieByImdbId(imdbId, true);\n    } catch (error) {",
)
sub_once(
    'src/services/radarr.ts',
    r"\n  private async tryGrabTopRelease\(movieId: number\): Promise<boolean> \{.*?\n  \}\n\n  invalidateCache",
    "\n  invalidateCache",
)

# Sonarr: use the POST-returned series ID for scoped monitoring and exact search,
# avoiding the list-visibility race immediately after creation.
replace_once('src/services/sonarr.ts', "  SonarrReleaseRecord,\n", '')
replace_once(
    'src/services/sonarr.ts',
    "        detail: current.title,\n        alreadyExisted: true",
    "        detail: current.title,\n        alreadyExisted: true,\n        itemId: current.id",
)
replace_once(
    'src/services/sonarr.ts',
    "    try {\n      await this.http.post('/api/v3/series', payload);\n    } catch (error) {",
    "    let created: SonarrSeriesRecord;\n    try {\n      created = await this.http.post<SonarrSeriesRecord>('/api/v3/series', payload);\n    } catch (error) {",
)
replace_once(
    'src/services/sonarr.ts',
    "        monitorMode\n      );",
    "        monitorMode,\n        created.id\n      );",
)
replace_once(
    'src/services/sonarr.ts',
    "      summary: 'Series added.',\n      detail: lookup.title",
    "      summary: 'Series added.',\n      detail: lookup.title,\n      itemId: created.id",
)
replace_once(
    'src/services/sonarr.ts',
    "    episode: number,\n    mode: 'ep' | 'epfuture' | 'epseason'\n  ): Promise<{ ok: true } | { ok: false; result: AddActionResult }> {\n    const startedAt = Date.now();\n    let series: SonarrSeriesRecord | undefined;",
    "    episode: number,\n    mode: 'ep' | 'epfuture' | 'epseason',\n    knownSeriesId?: number\n  ): Promise<{ ok: true } | { ok: false; result: AddActionResult }> {\n    const startedAt = Date.now();\n    let series: SonarrSeriesRecord | undefined = knownSeriesId != null\n      ? { id: knownSeriesId, imdbId, title: imdbId }\n      : undefined;",
)
replace_once(
    'src/services/sonarr.ts',
    "    options: { existingBeforeAction?: boolean } = { existingBeforeAction: true }\n  ): Promise<AddActionResult> {",
    "    options: { existingBeforeAction?: boolean; knownSeriesId?: number; knownTitle?: string } = { existingBeforeAction: true }\n  ): Promise<AddActionResult> {",
)
replace_once(
    'src/services/sonarr.ts',
    "    let series: SonarrSeriesRecord | undefined;\n    try {\n      series = await this.findSeriesByImdbId(imdbId, true);",
    "    let series: SonarrSeriesRecord | undefined = options.knownSeriesId != null\n      ? { id: options.knownSeriesId, imdbId, title: options.knownTitle ?? imdbId }\n      : undefined;\n    try {\n      series ??= await this.findSeriesByImdbId(imdbId, true);",
)
sub_once(
    'src/services/sonarr.ts',
    r"\n  private async tryGrabTopRelease\(.*?\n  \}\n\n  async ping",
    "\n  async ping",
)

# Orchestration passes POST-returned IDs into the exact search phase.
replace_once(
    'src/services/status.ts',
    "      ? await this.radarr.triggerMovieSearch(parsed.imdbId, { existingBeforeAction: added.alreadyExisted === true })\n      : await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode, { existingBeforeAction: added.alreadyExisted === true });",
    "      ? await this.radarr.triggerMovieSearch(parsed.imdbId, {\n        existingBeforeAction: added.alreadyExisted === true,\n        knownMovieId: added.itemId,\n        knownTitle: added.detail\n      })\n      : await this.sonarr.triggerEpisodeSearch(parsed.imdbId, parsed.season, parsed.episode, {\n        existingBeforeAction: added.alreadyExisted === true,\n        knownSeriesId: added.itemId,\n        knownTitle: added.detail\n      });",
)

# Extend the focused policy regression suite.
replace_once(
    'test/existing-item-policy.test.ts',
    "import { SonarrClient } from '../src/services/sonarr.js';",
    "import { RadarrClient } from '../src/services/radarr.js';\nimport { SonarrClient } from '../src/services/sonarr.js';",
)
write(
    'test/existing-item-policy-advanced.test.ts',
    r'''import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarrClient } from '../src/services/radarr.js';
import { SonarrClient } from '../src/services/sonarr.js';
import { baseConfig } from './_helpers.js';

interface Call { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown }

function radarrHttp(options: {
  movies?: unknown[];
  lookup?: unknown[];
  created?: unknown;
  command?: unknown;
  onCall?: (call: Call) => void;
}) {
  return {
    async get<T>(path: string): Promise<T> {
      options.onCall?.({ method: 'GET', path });
      if (path === '/api/v3/movie') return (options.movies ?? []) as T;
      if (path.startsWith('/api/v3/movie/lookup')) return (options.lookup ?? []) as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'POST', path, body });
      if (path === '/api/v3/movie') return (options.created ?? {}) as T;
      if (path === '/api/v3/command') return (options.command ?? { id: 1 }) as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'PUT', path, body });
      return {} as T;
    }
  };
}

test('Radarr extend preserves P4 and only enables monitoring before exact search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.existingItemPolicy = 'extend';
  cfg.radarr.qualityProfileId = 1;
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 10, imdbId: 'tt10', title: 'Movie', monitored: false, qualityProfileId: 4 }],
    command: { id: 101 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt10');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.method !== 'GET'), [
    { method: 'PUT', path: '/api/v3/movie/editor', body: { movieIds: [10], monitored: true } },
    { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [10] } }
  ]);
});

test('Radarr apply-config explicitly replaces owned fields then exact-searches', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  cfg.radarr.existingItemPolicy = 'apply-config';
  cfg.radarr.qualityProfileId = 2;
  cfg.radarr.minimumAvailability = 'released';
  cfg.radarr.rootFolderPath = '/new-movies';
  cfg.radarr.tags = [2, 5];
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 11, imdbId: 'tt11', title: 'Movie', monitored: false, qualityProfileId: 4 }],
    command: { id: 102 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerMovieSearch('tt11');
  assert.equal(result.ok, true);
  const editor = calls.find((call) => call.path === '/api/v3/movie/editor');
  assert.deepEqual(editor?.body, {
    movieIds: [11], monitored: true, qualityProfileId: 2,
    minimumAvailability: 'released', rootFolderPath: '/new-movies',
    tags: [2, 5], applyTags: 'replace', moveFiles: false
  });
  assert.deepEqual(calls.at(-1), { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [11] } });
});

test('Radarr TMDB fallback finds an existing movie without IMDb ID', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Call[] = [];
  const tmdb = {
    async getMovieTmdbId() { return 900; },
    async getMovieReleaseDate() { return undefined; }
  };
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [{ id: 90, tmdbId: 900, title: 'TMDB Movie', monitored: true }],
    command: { id: 103 },
    onCall: (call) => calls.push(call)
  }) as never, tmdb as never);

  const result = await client.triggerMovieSearch('tt900');
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.body, { name: 'MoviesSearch', movieIds: [90] });
});

test('new Radarr POST ID bypasses stale list visibility and gets one exact search', async () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const calls: Call[] = [];
  const client = new RadarrClient(cfg, radarrHttp({
    movies: [],
    lookup: [{ title: 'New Movie', imdbId: 'tt91', tmdbId: 91, year: 2026 }],
    created: { id: 91, title: 'New Movie', imdbId: 'tt91', tmdbId: 91 },
    command: { id: 104 },
    onCall: (call) => calls.push(call)
  }) as never);

  const added = await client.addMovieByImdbId('tt91');
  assert.equal(added.itemId, 91);
  const searched = await client.triggerMovieSearch('tt91', {
    existingBeforeAction: false,
    knownMovieId: added.itemId,
    knownTitle: added.detail
  });
  assert.equal(searched.ok, true);
  assert.equal(calls.filter((call) => call.path === '/api/v3/movie').length, 2); // one GET + one POST
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command'), [
    { method: 'POST', path: '/api/v3/command', body: { name: 'MoviesSearch', movieIds: [91] } }
  ]);
});

function sonarrHttp(options: {
  series?: unknown[];
  lookup?: unknown[];
  episodes?: unknown[];
  created?: unknown;
  command?: unknown;
  onCall?: (call: Call) => void;
}) {
  return {
    async get<T>(path: string): Promise<T> {
      options.onCall?.({ method: 'GET', path });
      if (path === '/api/v3/series') return (options.series ?? []) as T;
      if (path.startsWith('/api/v3/series/lookup')) return (options.lookup ?? []) as T;
      if (path.startsWith('/api/v3/episode?seriesId=')) return (options.episodes ?? []) as T;
      if (path === '/api/v3/qualityprofile') return [] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'POST', path, body });
      if (path === '/api/v3/series') return (options.created ?? {}) as T;
      if (path === '/api/v3/command') return (options.command ?? { id: 1 }) as T;
      throw new Error(`Unexpected POST ${path}`);
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      options.onCall?.({ method: 'PUT', path, body });
      return {} as T;
    }
  };
}

test('Sonarr extend is additive and never narrows other episode monitoring', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'extend';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 20, imdbId: 'tt20', title: 'Show', monitored: false, qualityProfileId: 4, monitorNewItems: 'all' }],
    episodes: [
      { id: 201, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 202, seasonNumber: 1, episodeNumber: 2, monitored: false },
      { id: 203, seasonNumber: 1, episodeNumber: 3, monitored: true }
    ],
    command: { id: 2010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt20', 1, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.filter((call) => call.method === 'PUT'), [
    { method: 'PUT', path: '/api/v3/series/editor', body: { seriesIds: [20], monitored: true } },
    { method: 'PUT', path: '/api/v3/episode/monitor', body: { episodeIds: [202], monitored: true } }
  ]);
  assert.ok(!calls.some((call) => call.method === 'PUT' && (call.body as any)?.monitored === false));
});

test('Sonarr apply-config scoped mode is destructive only after explicit opt-in', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.existingItemPolicy = 'apply-config';
  cfg.sonarr.seriesMonitor = 'ep';
  cfg.sonarr.qualityProfileId = 2;
  cfg.sonarr.monitorNewItems = 'none';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 21, imdbId: 'tt21', title: 'Show', monitored: true, qualityProfileId: 4, monitorNewItems: 'all' }],
    episodes: [
      { id: 211, seasonNumber: 1, episodeNumber: 1, monitored: true },
      { id: 212, seasonNumber: 1, episodeNumber: 2, monitored: true }
    ],
    command: { id: 2110 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt21', 1, 2);
  assert.equal(result.ok, true);
  assert.ok(calls.some((call) => call.path === '/api/v3/series/editor' && (call.body as any).qualityProfileId === 2));
  assert.ok(calls.some((call) => call.path === '/api/v3/episode/monitor' && (call.body as any).monitored === false));
  assert.deepEqual(calls.at(-1)?.body, { name: 'EpisodeSearch', episodeIds: [212] });
});

test('Sonarr TVDB fallback finds a series without IMDb ID', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [{ id: 30, tvdbId: 777, title: 'TVDB Show', monitored: true }],
    lookup: [{ imdbId: 'tt777', tvdbId: 777, title: 'TVDB Show' }],
    episodes: [{ id: 301, seasonNumber: 2, episodeNumber: 4, monitored: true }],
    command: { id: 3010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const result = await client.triggerEpisodeSearch('tt777', 2, 4);
  assert.equal(result.ok, true);
  assert.deepEqual(calls.at(-1)?.body, { name: 'EpisodeSearch', episodeIds: [301] });
});

test('new Sonarr POST ID bypasses stale series list and exact-searches selected episode', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'all';
  cfg.sonarr.episodeReadyPollMs = 1;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  const calls: Call[] = [];
  const client = new SonarrClient(cfg, sonarrHttp({
    series: [],
    lookup: [{ title: 'New Show', imdbId: 'tt40', tvdbId: 40, year: 2026 }],
    created: { id: 40, title: 'New Show', imdbId: 'tt40', tvdbId: 40 },
    episodes: [{ id: 401, seasonNumber: 1, episodeNumber: 1, monitored: true }],
    command: { id: 4010 },
    onCall: (call) => calls.push(call)
  }) as never);

  const added = await client.addSeriesByImdbId('tt40', { season: 1, episode: 1 });
  assert.equal(added.itemId, 40);
  const searched = await client.triggerEpisodeSearch('tt40', 1, 1, {
    existingBeforeAction: false,
    knownSeriesId: added.itemId,
    knownTitle: added.detail
  });
  assert.equal(searched.ok, true);
  assert.equal(calls.filter((call) => call.path === '/api/v3/series').length, 2); // one GET + one POST
  assert.deepEqual(calls.filter((call) => call.path === '/api/v3/command'), [
    { method: 'POST', path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [401] } }
  ]);
});
''',
)

# Configuration defaults and enum validation.
with Path('test/config.test.ts').open('a', encoding='utf-8') as handle:
    handle.write(r'''

test('existing-item policies default to preserve', () => {
  const config = loadConfig();
  assert.equal(config.radarr.existingItemPolicy, 'preserve');
  assert.equal(config.sonarr.existingItemPolicy, 'preserve');
});

test('existing-item policy parsing is case-insensitive', () => {
  process.env.RADARR_EXISTING_ITEM_POLICY = 'EXTEND';
  process.env.SONARR_EXISTING_ITEM_POLICY = 'APPLY-CONFIG';
  const config = loadConfig();
  assert.equal(config.radarr.existingItemPolicy, 'extend');
  assert.equal(config.sonarr.existingItemPolicy, 'apply-config');
});

test('invalid existing-item policies fail startup validation', () => {
  process.env.RADARR_EXISTING_ITEM_POLICY = 'overwrite-everything';
  assert.throws(() => loadConfig(), /RADARR_EXISTING_ITEM_POLICY/);
  delete process.env.RADARR_EXISTING_ITEM_POLICY;
  process.env.SONARR_EXISTING_ITEM_POLICY = 'maybe';
  assert.throws(() => loadConfig(), /SONARR_EXISTING_ITEM_POLICY/);
});
''')

# Configure page/persistence coverage.
replace_once(
    'test/config-ui.test.ts',
    "      assert.match(html, /id=\"radarr-enabled\"[^>]*><option value=\"true\">Enabled<\\/option><option value=\"false\">Disabled<\\/option>/);",
    "      assert.match(html, /id=\"radarr-enabled\"[^>]*><option value=\"true\">Enabled<\\/option><option value=\"false\">Disabled<\\/option>/);\n      assert.match(html, /id=\"radarr-existing-policy\"/);\n      assert.match(html, /id=\"sonarr-existing-policy\"/);\n      assert.match(html, /Preserve existing settings \(recommended\)/);",
)
replace_once(
    'test/config-ui.test.ts',
    "    payload.radarr.tags = '1,3';",
    "    payload.radarr.tags = '1,3';\n    payload.radarr.existingItemPolicy = 'apply-config';\n    payload.sonarr.existingItemPolicy = 'extend';",
)
replace_once(
    'test/config-ui.test.ts',
    "    assert.match(saved, /RADARR_TAGS=1,3/);",
    "    assert.match(saved, /RADARR_TAGS=1,3/);\n    assert.match(saved, /RADARR_EXISTING_ITEM_POLICY=apply-config/);\n    assert.match(saved, /SONARR_EXISTING_ITEM_POLICY=extend/);",
)

# Clarify the race-safe implementation in the durable design.
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    "- resolve the created/existing movie record;\n- queue one explicit `MoviesSearch` for the exact movie ID.",
    "- retain the movie ID returned by the add response rather than waiting for list-cache visibility;\n- queue one explicit `MoviesSearch` for that exact movie ID.",
)
replace_once(
    'docs/EXISTING-ARR-ITEM-POLICY.md',
    "- wait for exact episode metadata;\n- queue one explicit `EpisodeSearch` for the exact episode ID.",
    "- retain the series ID returned by the add response, then wait for exact episode metadata;\n- queue one explicit `EpisodeSearch` for the exact episode ID.",
)

print('Final existing-item policy hardening patch applied.')
