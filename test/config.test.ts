import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { loadConfig, validateConfig, DEFAULT_MANIFEST_LOGO_URL } from '../src/config.js';
import { baseConfig } from './_helpers.js';

const PKG_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test.beforeEach(() => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
});

test('loads valid config', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.RADARR_ENABLED = 'true';
  process.env.RADARR_BASE_URL = 'http://127.0.0.1:7878';
  process.env.RADARR_API_KEY = 'abc';
  process.env.RADARR_ROOT_FOLDER_PATH = '/movies';

  const config = loadConfig();
  assert.equal(config.radarr.enabled, true);
  assert.equal(config.radarr.baseUrl, 'http://127.0.0.1:7878');
  assert.equal(config.radarr.cardUrl, 'http://127.0.0.1:7878');
  assert.equal(config.manifestLogoUrl, DEFAULT_MANIFEST_LOGO_URL);
});

test('manifest logo url accepts explicit https override', () => {
  process.env.MANIFEST_LOGO_URL = 'https://example.com/stremio/logo.png';
  const config = loadConfig();
  assert.equal(config.manifestLogoUrl, 'https://example.com/stremio/logo.png');
});

test('manifest logo url accepts https url with query parameters', () => {
  process.env.MANIFEST_LOGO_URL = 'https://img.icons8.com/?size=200&id=43669&format=png';
  const config = loadConfig();
  assert.equal(config.manifestLogoUrl, 'https://img.icons8.com/?size=200&id=43669&format=png');
});

test('manifest logo url rejects http urls', () => {
  process.env.MANIFEST_LOGO_URL = 'http://example.com/logo.png';
  assert.throws(() => loadConfig(), /MANIFEST_LOGO_URL/);
});

test('manifest logo url supports explicit none keyword', () => {
  process.env.MANIFEST_LOGO_URL = 'none';
  const config = loadConfig();
  assert.equal(config.manifestLogoUrl, '');
});

test('card urls allow display override without changing API base url', () => {
  process.env.RADARR_ENABLED = 'true';
  process.env.RADARR_BASE_URL = 'http://127.0.0.1:7878';
  process.env.RADARR_CARD_URL = '192.168.1.50:7878';
  process.env.RADARR_API_KEY = 'abc';
  process.env.RADARR_ROOT_FOLDER_PATH = '/movies';

  const config = loadConfig();
  assert.equal(config.radarr.baseUrl, 'http://127.0.0.1:7878');
  assert.equal(config.radarr.cardUrl, '192.168.1.50:7878');
});

test('fails for invalid timeout', () => {
  process.env.REQUEST_TIMEOUT_MS = '500';
  assert.throws(() => loadConfig(), /REQUEST_TIMEOUT_MS/);
});

test('fails for invalid URL', () => {
  process.env.PUBLIC_BASE_URL = 'ftp://bad';
  assert.throws(() => loadConfig(), /PUBLIC_BASE_URL/);
});

test('fails for PUBLIC_BASE_URL with embedded credentials', () => {
  process.env.PUBLIC_BASE_URL = 'http://user:pass@127.0.0.1:7010';
  assert.throws(() => loadConfig(), /PUBLIC_BASE_URL/);
});

test('validateConfig warns when PUBLIC_BASE_URL uses HTTP', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'http://192.168.1.50:7010';
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, false);
  assert.ok(result.issues.includes('PUBLIC_BASE_URL uses HTTP'));
});

test('validateConfig marks public HTTPS hostname as Android-TV compatible', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'https://stremio-addarr.example.com';
  cfg.radarr.enabled = true;
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, true);
  assert.equal(result.likelyAndroidTvCompatible, true);
  assert.equal(result.isInternalHostname, false);
});

test('validateConfig flags localhost HTTP as Android-TV incompatible', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'http://127.0.0.1:7010';
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, false);
  assert.ok(result.issues.includes('Android TV compatibility likely broken'));
});

test('validateConfig flags internal-only hostname for android-tv target', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';
  const result = validateConfig(cfg);
  assert.ok(result.issues.includes('PUBLIC_BASE_URL uses internal-only hostname'));
  assert.equal(result.likelyAndroidTvCompatible, false);
});

test('validateConfig flags path-prefix origins as unsupported', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'https://stremio-addarr.example.com/addarr';
  const result = validateConfig(cfg);
  assert.ok(result.issues.includes('PUBLIC_BASE_URL includes a path prefix, which is unsupported'));
});

test('validateConfig allows generic target for advanced/local setups', () => {
  const cfg = baseConfig();
  cfg.targetClient = 'generic';
  cfg.publicBaseUrl = 'http://127.0.0.1:7010';
  const result = validateConfig(cfg);
  assert.equal(result.likelyAndroidTvCompatible, true);
  assert.ok(!result.issues.includes('Android TV compatibility likely broken'));
});

test('validateConfig warns when neither service is enabled', () => {
  const cfg = baseConfig(); // both disabled
  const result = validateConfig(cfg);
  assert.ok(result.issues.some((i) => /neither/i.test(i)));
});

test('validateConfig has no neither-enabled warning when at least one service is enabled', () => {
  const cfg = baseConfig();
  cfg.radarr.enabled = true;
  const result = validateConfig(cfg);
  assert.ok(!result.issues.some((i) => /neither/i.test(i)));
});


test('fails for PUBLIC_BASE_URL with query string', () => {
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:7010/?x=1';
  assert.throws(() => loadConfig(), /must not include query or hash/);
});

test('enabled Radarr requires root folder path', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.RADARR_ENABLED = 'true';
  process.env.RADARR_BASE_URL = 'http://127.0.0.1:7878';
  process.env.RADARR_API_KEY = 'abc';
  process.env.RADARR_ROOT_FOLDER_PATH = '';
  assert.throws(() => loadConfig(), /RADARR_ROOT_FOLDER_PATH/);
});

test('enabled Sonarr requires positive profile ids', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_QUALITY_PROFILE_ID = '0';
  assert.throws(() => loadConfig(), /SONARR_QUALITY_PROFILE_ID/);
});

test('enabled Sonarr validates SONARR_SERIES_MONITOR enum', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_SERIES_MONITOR = 'invalid_value';
  assert.throws(() => loadConfig(), /SONARR_SERIES_MONITOR/);
});

test('enabled Sonarr accepts case-insensitive SONARR_SERIES_MONITOR', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_SERIES_MONITOR = 'ALL';
  const config = loadConfig();
  assert.equal(config.sonarr.seriesMonitor, 'all');
});

test('enabled Sonarr accepts future as SONARR_SERIES_MONITOR', () => {
  process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_SERIES_MONITOR = 'future';
  const config = loadConfig();
  assert.equal(config.sonarr.seriesMonitor, 'future');
});

test('enabled Sonarr accepts episode-scoped values in SONARR_SERIES_MONITOR', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_SERIES_MONITOR = 'epfuture';
  const config = loadConfig();
  assert.equal(config.sonarr.seriesMonitor, 'epfuture');
});

test('enabled Sonarr validates SONARR_SERIES_MONITOR custom mode enum', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_SERIES_MONITOR = 'broken';
  assert.throws(() => loadConfig(), /SONARR_SERIES_MONITOR/);
});

test('enabled Sonarr validates episode ready poll/timeout bounds', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_EPISODE_READY_TIMEOUT_MS = '1000';
  process.env.SONARR_EPISODE_READY_POLL_MS = '5000';
  assert.throws(() => loadConfig(), /SONARR_EPISODE_READY_POLL_MS/);
});

test('enabled Sonarr accepts SONARR_MONITOR_NEW_ITEMS override', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.SONARR_MONITOR_NEW_ITEMS = 'none';
  const config = loadConfig();
  assert.equal(config.sonarr.monitorNewItems, 'none');
});

test('enabled Sonarr validates EP_COUNT_MOD', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.EP_COUNT_MOD = 'bad';
  assert.throws(() => loadConfig(), /EP_COUNT_MOD/);
});

test('blank EP_COUNT disables EP_COUNT logic', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.EP_COUNT = '';
  const config = loadConfig();
  assert.equal(config.sonarr.epCount, 0);
});

test('EP_COUNT_PAST can be overridden', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.EP_COUNT_PAST = '5';
  const config = loadConfig();
  assert.equal(config.sonarr.epCountPast, 5);
});

test('EP_COUNT_PAST validation rejects non-numeric values', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://127.0.0.1:8989';
  process.env.SONARR_API_KEY = 'abc';
  process.env.SONARR_ROOT_FOLDER_PATH = '/tv';
  process.env.EP_COUNT_PAST = 'abc';
  assert.throws(() => loadConfig(), /EP_COUNT_PAST/);
});

test('enabled Sonarr accepts lastSeason as SONARR_SERIES_MONITOR', () => {
  process.env.SONARR_ENABLED = 'true';
  process.env.SONARR_BASE_URL = 'http://sonarr.local:8989';
  process.env.SONARR_API_KEY = 'sonarr-key';
  process.env.SONARR_ROOT_FOLDER_PATH = '/data/tv';
  process.env.SONARR_SERIES_MONITOR = 'lastSeason';

  const config = loadConfig();
  assert.equal(config.sonarr.seriesMonitor, 'lastSeason');
});

test('disabled Sonarr ignores invalid SONARR_SERIES_MONITOR', () => {
  process.env.SONARR_ENABLED = 'false';
  process.env.SONARR_SERIES_MONITOR = 'invalid_value';
  const config = loadConfig();
  assert.equal(config.sonarr.enabled, false);
  assert.equal(config.sonarr.seriesMonitor, 'all');
});

test('fails for invalid FORCED_SHUTDOWN_EXIT_CODE', () => {
  process.env.FORCED_SHUTDOWN_EXIT_CODE = '2';
  assert.throws(() => loadConfig(), /FORCED_SHUTDOWN_EXIT_CODE/);
});


test('fails for low service health cache ttl', () => {
  process.env.SERVICE_HEALTH_CACHE_TTL_MS = '500';
  assert.throws(() => loadConfig(), /SERVICE_HEALTH_CACHE_TTL_MS/);
});

test('fails for negative stream cache hints', () => {
  process.env.STREAM_CACHE_MAX_AGE = '-1';
  assert.throws(() => loadConfig(), /STREAM_CACHE_MAX_AGE/);
});

test('fails for invalid catalog page size', () => {
  process.env.CATALOG_PAGE_SIZE = '0';
  assert.throws(() => loadConfig(), /CATALOG_PAGE_SIZE/);
});

test('fails for negative catalog stale error hint', () => {
  process.env.CATALOG_STALE_ERROR_SEC = '-1';
  assert.throws(() => loadConfig(), /CATALOG_STALE_ERROR_SEC/);
});

test('fails for unknown TARGET_CLIENT', () => {
  process.env.TARGET_CLIENT = 'android-phone';
  assert.throws(() => loadConfig(), /TARGET_CLIENT/);
});

test('config version loads from package.json when npm_package_version is absent', () => {
  delete process.env.npm_package_version;
  delete process.env.APP_VERSION;
  const config = loadConfig();
  assert.equal(config.version, PKG_VERSION);
});

test('APP_VERSION overrides package version', () => {
  process.env.APP_VERSION = '9.9.9-test';
  const config = loadConfig();
  assert.equal(config.version, '9.9.9-test');
});

test('allows empty KODI_PACKAGE when Kodi is disabled', () => {
  process.env.KODI_ENABLED = 'false';
  process.env.KODI_PACKAGE = '';
  const config = loadConfig();
  assert.equal(config.kodi.enabled, false);
});

test('file streaming defaults to disabled with no secret required', () => {
  const config = loadConfig();
  assert.equal(config.fileStreaming.enabled, false);
  assert.equal(config.fileStreaming.secret, '');
  assert.equal(config.fileStreaming.playbackMode, 'kodi');
});

test('file streaming loads when enabled with a secret', () => {
  process.env.FILE_STREAMING_ENABLED = 'true';
  process.env.FILE_STREAMING_SECRET = 'a-long-enough-secret-for-streaming!!';
  const config = loadConfig();
  assert.equal(config.fileStreaming.enabled, true);
  assert.equal(config.fileStreaming.secret, 'a-long-enough-secret-for-streaming!!');
  assert.equal(config.fileStreaming.playbackMode, 'direct');
});

test('file streaming allows explicit kodi playback mode', () => {
  process.env.FILE_STREAMING_ENABLED = 'true';
  process.env.FILE_STREAMING_SECRET = 'a-long-enough-secret-for-streaming!!';
  process.env.FILE_STREAMING_PLAYBACK_MODE = 'kodi';
  const config = loadConfig();
  assert.equal(config.fileStreaming.playbackMode, 'kodi');
});

test('file streaming rejects unknown playback mode', () => {
  process.env.FILE_STREAMING_PLAYBACK_MODE = 'vlc';
  assert.throws(() => loadConfig(), /FILE_STREAMING_PLAYBACK_MODE/);
});

test('file streaming fails when enabled without a secret', () => {
  process.env.FILE_STREAMING_ENABLED = 'true';
  process.env.FILE_STREAMING_SECRET = '';
  assert.throws(() => loadConfig(), /FILE_STREAMING_SECRET/);
});

test('trakt sync defaults to disabled', () => {
  const config = loadConfig();
  assert.equal(config.traktSync.enabled, false);
  assert.equal(config.traktSync.syncMins, 360);
});

test('trakt sync requires credentials when enabled', () => {
  process.env.TRAKT_SYNC_ENABLED = 'true';
  process.env.TRAKT_CLIENT_ID = '';
  process.env.TRAKT_CLIENT_SECRET = '';
  process.env.TRAKT_REFRESH_TOKEN = '';
  assert.throws(() => loadConfig(), /TRAKT_CLIENT_ID/);
});

test('trakt sync accepts explicit configuration', () => {
  process.env.TRAKT_SYNC_ENABLED = 'true';
  process.env.TRAKT_SYNC_MINS = '120';
  process.env.TRAKT_CLIENT_ID = 'client-id';
  process.env.TRAKT_CLIENT_SECRET = 'client-secret';
  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';
  process.env.TRAKT_API_BASE_URL = 'https://api.trakt.tv';
  const config = loadConfig();
  assert.equal(config.traktSync.enabled, true);
  assert.equal(config.traktSync.syncMins, 120);
  assert.equal(config.traktSync.clientId, 'client-id');
});

test('trakt sync mins is clamped to 40 when env is <=40', () => {
  process.env.TRAKT_SYNC_ENABLED = 'true';
  process.env.TRAKT_SYNC_MINS = '1';
  process.env.TRAKT_CLIENT_ID = 'client-id';
  process.env.TRAKT_CLIENT_SECRET = 'client-secret';
  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';
  const config = loadConfig();
  assert.equal(config.traktSync.syncMins, 40);
});
