from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    text = file_path.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}")
    file_path.write_text(text.replace(old, new, 1))


status_path = "src/services/status.ts"

replace_once(
    status_path,
    """function desc(...lines: string[]): string {
  return lines.filter(Boolean).join('\\n');
}

export class ArrStatusService {""",
    """function desc(...lines: string[]): string {
  return lines.filter(Boolean).join('\\n');
}

export function seriesMonitorScopeLine(mode: AppConfig['sonarr']['seriesMonitor']): string {
  const scopes: Record<AppConfig['sonarr']['seriesMonitor'], string> = {
    all: 'all episodes',
    future: 'future episodes',
    missing: 'missing episodes',
    existing: 'existing episodes',
    firstSeason: 'first season',
    lastSeason: 'last season',
    latestSeason: 'latest season',
    pilot: 'pilot only',
    recent: 'recent episodes',
    monitorSpecials: 'include specials',
    unmonitorSpecials: 'exclude specials',
    none: 'no episodes',
    skip: 'leave unchanged',
    ep: 'this episode only',
    epfuture: 'this + future episodes',
    epseason: 'this episode to season end'
  };
  return `📡 Monitor scope: ${scopes[mode]}`;
}

export class ArrStatusService {"""
)

replace_once(
    status_path,
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),""",
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} missing` : '⭕ Episode missing', seriesMonitorScopeLine(this.config.sonarr.seriesMonitor), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),"""
)

replace_once(
    status_path,
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),""",
    """description: desc(watchedLine(watched, borderFallback), seriesLine(status.title), ep ? `⭕ ${ep} monitored` : '⭕ In library', seriesMonitorScopeLine(this.config.sonarr.seriesMonitor), '🗯️ 🔍  SEARCH FOR DL 📥📀', this.sonarrCardLine()),"""
)

replace_once(
    status_path,
    """description: desc(watchedLine(watched, borderFallback), '📺  Not in Sonarr', ep, '🗯️ ➕  ADD SERIES + SEARCH ►', this.sonarrCardLine()),""",
    """description: desc(watchedLine(watched, borderFallback), '📺  Not in Sonarr', ep, seriesMonitorScopeLine(this.config.sonarr.seriesMonitor), '🗯️ ➕  ADD SERIES + SEARCH ►', this.sonarrCardLine()),"""
)


test_path = "test/addon.test.ts"
replace_once(
    test_path,
    """import { buildDefaultManifestLogoUrl } from '../src/config.js';""",
    """import { buildDefaultManifestLogoUrl } from '../src/config.js';
import { seriesMonitorScopeLine } from '../src/services/status.js';"""
)

replace_once(
    test_path,
    """test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
});

test('manifest endpoint shape sanity', async () => {""",
    """test.afterEach(() => {
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

test('manifest endpoint shape sanity', async () => {"""
)

replace_once(
    test_path,
    """  cfg.sonarr.enabled = true;
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';""",
    """  cfg.sonarr.enabled = true;
  cfg.sonarr.seriesMonitor = 'epfuture';
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';"""
)

replace_once(
    test_path,
    """    assert.ok(body.streams[0].description?.includes('S02E05'), 'description should include episode label');""",
    """    assert.ok(body.streams[0].description?.includes('S02E05'), 'description should include episode label');
    assert.ok(
      body.streams[0].description?.includes('📡 Monitor scope: this + future episodes'),
      'description should explain the configured Sonarr monitoring scope'
    );"""
)
