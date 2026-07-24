from __future__ import annotations

import json
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
        raise SystemExit(f'{path}: expected one occurrence, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def replace_first(path: str, old: str, new: str) -> None:
    text = read(path)
    count = text.count(old)
    if count < 1:
        raise SystemExit(f'{path}: expected at least one occurrence, found {count}: {old[:100]!r}')
    write(path, text.replace(old, new, 1))


def sub_once(path: str, pattern: str, replacement: str) -> None:
    text = read(path)
    updated, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'{path}: expected one regex occurrence, found {count}: {pattern[:120]!r}')
    write(path, updated)


# Normal PR CI runs before the main one-shot source transformation. Leave the
# temporary lifecycle hook in place until the implementation job has added the
# policy type, then perform and self-remove the legacy test migration.
if "export type ExistingItemPolicy" not in read('src/config.ts'):
    print('Existing-item implementation is not applied yet; test migration skipped.')
    raise SystemExit(0)


sub_once(
    'test/sonarr.test.ts',
    r"test\('triggerEpisodeSearch posts EpisodeSearch command'.*?\n\}\);\n\ntest\('queue failure",
    """test('triggerEpisodeSearch queues the exact episode and requires command acknowledgement', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  cfg.sonarr.episodeReadyPollMs = 1;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99', monitored: true }] as T;
      if (path === '/api/v3/episode?seriesId=41') return [{ id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return { id: 155, name: 'EpisodeSearch', status: 'queued' } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };

  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.equal(result.commandId, 155);
  assert.deepEqual(calls, [{ path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [55] } }]);
});

test('triggerEpisodeSearch preserve ignores configured epfuture and does not mutate monitoring', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epfuture';
  cfg.sonarr.existingItemPolicy = 'preserve';
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  cfg.sonarr.episodeReadyPollMs = 1;
  const calls: Array<{ path: string; body?: unknown }> = [];
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 41, imdbId: 'tt99', title: 'Show99', monitored: true, monitorNewItems: 'all', qualityProfileId: 4 }] as T;
      if (path === '/api/v3/episode?seriesId=41') return [
        { id: 55, seasonNumber: 3, episodeNumber: 2, monitored: true },
        { id: 56, seasonNumber: 3, episodeNumber: 3, monitored: false },
        { id: 57, seasonNumber: 4, episodeNumber: 1, monitored: false }
      ] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return { id: 156 } as T;
    },
    async put<T>(path: string, body: unknown): Promise<T> {
      calls.push({ path, body });
      return {} as T;
    }
  };

  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt99', 3, 2);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{ path: '/api/v3/command', body: { name: 'EpisodeSearch', episodeIds: [55] } }]);
});

test('triggerEpisodeSearch fails when Sonarr omits the command id', async () => {
  const cfg = baseConfig();
  cfg.sonarr.enabled = true;
  cfg.sonarr.episodeReadyTimeoutMs = 20;
  cfg.sonarr.episodeReadyPollMs = 1;
  const http = {
    async get<T>(path: string): Promise<T> {
      if (path === '/api/v3/series') return [{ id: 77, imdbId: 'tt98', title: 'Show98' }] as T;
      if (path === '/api/v3/episode?seriesId=77') return [{ id: 80, seasonNumber: 2, episodeNumber: 5, monitored: false }] as T;
      throw new Error(`Unexpected GET ${path}`);
    },
    async post<T>(): Promise<T> { return {} as T; },
    async put<T>(): Promise<T> { return {} as T; }
  };

  const result = await new SonarrClient(cfg, http as never).triggerEpisodeSearch('tt98', 2, 5);
  assert.equal(result.ok, false);
  assert.match(result.title, /not accepted/i);
});

test('queue failure""",
)

# Action route mocks must return real Arr command acknowledgements. The first
# two fixtures intentionally share the same original text and are migrated in
# order, so each operation only requires that one occurrence remains.
replace_first(
    'test/app-routes.test.ts',
    "      return new Response('{}', { status: 201 });\n    }\n    if (path === '/api/v3/system/status') {",
    "      return new Response('{\"id\":1001,\"name\":\"MoviesSearch\",\"status\":\"queued\"}', { status: 201 });\n    }\n    if (path === '/api/v3/system/status') {",
)
replace_first(
    'test/app-routes.test.ts',
    "      return new Response('{}', { status: 201 });\n    }\n    if (path === '/api/v3/system/status') {",
    "      return new Response('{\"id\":2001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });\n    }\n    if (path === '/api/v3/system/status') {",
)
replace_once(
    'test/app-routes.test.ts',
    "    if (path.startsWith('/api/v3/queue?')) return new Response('{\"records\":[]}', { status: 200 });\n    if (path === '/api/v3/command' && init?.method === 'POST') {\n      resolveCommandPosted();\n      return new Response('{}', { status: 201 });\n    }",
    "    if (path.startsWith('/api/v3/episode?seriesId=111')) return new Response('[{\"id\":112,\"seasonNumber\":1,\"episodeNumber\":1,\"monitored\":true}]', { status: 200 });\n    if (path.startsWith('/api/v3/queue?')) return new Response('{\"records\":[]}', { status: 200 });\n    if (path === '/api/v3/command' && init?.method === 'POST') {\n      resolveCommandPosted();\n      return new Response('{\"id\":3001,\"name\":\"EpisodeSearch\",\"status\":\"queued\"}', { status: 201 });\n    }",
)
replace_once(
    'test/app-routes.test.ts',
    "signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt1111111')",
    "signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt1111111:1:1')",
)

# The exact-search implementation can legitimately poll for a newly created
# episode. Keep production defaults unchanged while ensuring mock failures are
# bounded and deterministic.
replace_once(
    'test/_helpers.ts',
    "      episodeReadyTimeoutMs: 60_000,\n      episodeReadyPollMs: 1_500,",
    "      episodeReadyTimeoutMs: 100,\n      episodeReadyPollMs: 1,",
)

# This script is invoked once through npm's `preci` lifecycle and removes its
# temporary lifecycle hook before the implementation commit is created.
package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
scripts = package.get('scripts', {})
if scripts.get('preci') != 'python3 scripts/update-existing-item-policy-tests.py':
    raise SystemExit('package.json: temporary preci hook is missing or unexpected')
del scripts['preci']
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
Path(__file__).unlink()

print('Legacy action tests migrated to exact-search semantics.')
