import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.js';
import { baseConfig } from './_helpers.js';

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


test('fails for low service health cache ttl', () => {
  process.env.SERVICE_HEALTH_CACHE_TTL_MS = '500';
  assert.throws(() => loadConfig(), /SERVICE_HEALTH_CACHE_TTL_MS/);
});

test('fails for negative stream cache hints', () => {
  process.env.STREAM_CACHE_MAX_AGE = '-1';
  assert.throws(() => loadConfig(), /STREAM_CACHE_MAX_AGE/);
});

test('fails for unknown TARGET_CLIENT', () => {
  process.env.TARGET_CLIENT = 'android-phone';
  assert.throws(() => loadConfig(), /TARGET_CLIENT/);
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
});

test('file streaming loads when enabled with a secret', () => {
  process.env.FILE_STREAMING_ENABLED = 'true';
  process.env.FILE_STREAMING_SECRET = 'a-long-enough-secret-for-streaming!!';
  const config = loadConfig();
  assert.equal(config.fileStreaming.enabled, true);
  assert.equal(config.fileStreaming.secret, 'a-long-enough-secret-for-streaming!!');
});

test('file streaming fails when enabled without a secret', () => {
  process.env.FILE_STREAMING_ENABLED = 'true';
  process.env.FILE_STREAMING_SECRET = '';
  assert.throws(() => loadConfig(), /FILE_STREAMING_SECRET/);
});
