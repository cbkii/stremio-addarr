import test from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicUrl, loadConfig } from '../src/config.js';

test('validatePublicUrl: HTTPS non-localhost is valid with no warnings', () => {
  const result = validatePublicUrl('https://stremio-addarr.lan');
  assert.equal(result.isHttps, true);
  assert.equal(result.isLocalhost, false);
  assert.equal(result.warnings.length, 0);
});

test('validatePublicUrl: HTTP on non-localhost warns about HTTPS', () => {
  const result = validatePublicUrl('http://192.168.1.100:7010');
  assert.equal(result.isHttps, false);
  assert.equal(result.isLocalhost, false);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('HTTPS'));
});

test('validatePublicUrl: localhost warns about remote inaccessibility', () => {
  const result = validatePublicUrl('http://127.0.0.1:7010');
  assert.equal(result.isHttps, false);
  assert.equal(result.isLocalhost, true);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('localhost'));
});

test('validatePublicUrl: invalid URL warns and returns no https/localhost', () => {
  const result = validatePublicUrl('not-a-url');
  assert.equal(result.isHttps, false);
  assert.equal(result.isLocalhost, false);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('valid URL'));
});

test('validatePublicUrl: HTTPS localhost has no HTTPS warning but is flagged localhost', () => {
  const result = validatePublicUrl('https://127.0.0.1');
  assert.equal(result.isHttps, true);
  assert.equal(result.isLocalhost, true);
  // Should still warn about loopback being unreachable for remote clients
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes('localhost'));
});

test('loadConfig: defaults are applied when env vars not set', () => {
  // Unset relevant env vars to test defaults
  const savedEnv: Record<string, string | undefined> = {};
  const keys = [
    'HOST', 'PORT', 'PUBLIC_BASE_URL', 'LOG_LEVEL',
    'REQUEST_TIMEOUT_MS', 'STATUS_CACHE_TTL_MS', 'ACTION_CONFIRM',
    'RADARR_ENABLED', 'RADARR_BASE_URL', 'RADARR_API_KEY',
    'SONARR_ENABLED', 'SONARR_BASE_URL', 'SONARR_API_KEY'
  ];
  for (const k of keys) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }

  try {
    const config = loadConfig();
    assert.equal(config.host, '0.0.0.0');
    assert.equal(config.port, 7010);
    assert.equal(config.publicBaseUrl, 'http://127.0.0.1:7010');
    assert.equal(config.logLevel, 'info');
    assert.equal(config.requestTimeoutMs, 5000);
    assert.equal(config.statusCacheTtlMs, 30000);
    assert.equal(config.actionConfirm, false);
    assert.equal(config.radarr.enabled, false);
    assert.equal(config.sonarr.enabled, false);
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
});

test('loadConfig: throws when Radarr enabled without credentials', () => {
  const savedEnv: Record<string, string | undefined> = {};
  const keys = ['RADARR_ENABLED', 'RADARR_BASE_URL', 'RADARR_API_KEY', 'SONARR_ENABLED'];
  for (const k of keys) {
    savedEnv[k] = process.env[k];
  }

  process.env['RADARR_ENABLED'] = 'true';
  process.env['RADARR_BASE_URL'] = '';
  process.env['RADARR_API_KEY'] = '';
  process.env['SONARR_ENABLED'] = 'false';

  try {
    assert.throws(() => loadConfig(), /RADARR_BASE_URL or RADARR_API_KEY/);
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
});

test('loadConfig: publicUrlValidation is populated', () => {
  const savedEnv = process.env['PUBLIC_BASE_URL'];
  process.env['PUBLIC_BASE_URL'] = 'https://stremio-addarr.lan';

  try {
    const config = loadConfig();
    assert.equal(config.publicUrlValidation.isHttps, true);
    assert.equal(config.publicUrlValidation.isLocalhost, false);
    assert.equal(config.publicUrlValidation.warnings.length, 0);
  } finally {
    if (savedEnv === undefined) {
      delete process.env['PUBLIC_BASE_URL'];
    } else {
      process.env['PUBLIC_BASE_URL'] = savedEnv;
    }
  }
});
