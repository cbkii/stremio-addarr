import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig, validateConfig } from '../src/config.js';
import { baseConfig } from './_helpers.js';

const ORIGINAL_ENV = { ...process.env };

test.afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

test('loads valid config', () => {
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:7010';
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

test('validateConfig warns when PUBLIC_BASE_URL is not HTTPS and not localhost', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'http://192.168.1.50:7010';
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, false);
  assert.ok(result.issues.some((i) => /HTTPS/i.test(i)));
});

test('validateConfig has no issue when PUBLIC_BASE_URL is HTTPS', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'https://stremio-addarr.lan';
  cfg.radarr.enabled = true;
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, true);
  assert.ok(!result.issues.some((i) => /HTTPS/i.test(i)));
});

test('validateConfig has no HTTPS issue when PUBLIC_BASE_URL is localhost HTTP', () => {
  const cfg = baseConfig();
  cfg.publicBaseUrl = 'http://127.0.0.1:7010';
  const result = validateConfig(cfg);
  assert.equal(result.isHttps, false);
  assert.ok(!result.issues.some((i) => /HTTPS/i.test(i)));
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
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:7010';
  process.env.RADARR_ENABLED = 'true';
  process.env.RADARR_BASE_URL = 'http://127.0.0.1:7878';
  process.env.RADARR_API_KEY = 'abc';
  process.env.RADARR_ROOT_FOLDER_PATH = '';
  assert.throws(() => loadConfig(), /RADARR_ROOT_FOLDER_PATH/);
});

test('enabled Sonarr requires positive profile ids', () => {
  process.env.PUBLIC_BASE_URL = 'http://127.0.0.1:7010';
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
