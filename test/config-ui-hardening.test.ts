import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { createApp } from '../src/index.js';
import { createConfigUiRouter, credentialForProbeOrigin } from '../src/config-ui-core.js';
import { createLogger } from '../src/logger.js';
import { baseConfig, withServer } from './_helpers.js';

const ORIGINAL_TOKEN = process.env['CONFIG_UI_TOKEN'];
const ORIGINAL_ENV_FILE = process.env['CONFIG_UI_ENV_FILE'];
const tempDirs: string[] = [];

function uiConfig() {
  const cfg = baseConfig();
  cfg.configUiEnabled = true;
  return cfg;
}

async function tempEnv(initial = ''): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'addarr-config-hardening-'));
  tempDirs.push(dir);
  const envFile = path.join(dir, '.env');
  await fs.writeFile(envFile, initial, { mode: 0o600 });
  return envFile;
}

async function login(baseUrl: string, token: string): Promise<{ cookie: string; csrf: string }> {
  const response = await fetch(`${baseUrl}/api/config/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { csrf: string };
  return {
    cookie: response.headers.get('set-cookie')?.split(';')[0] ?? '',
    csrf: body.csrf
  };
}

test.afterEach(async () => {
  if (ORIGINAL_TOKEN === undefined) delete process.env['CONFIG_UI_TOKEN'];
  else process.env['CONFIG_UI_TOKEN'] = ORIGINAL_TOKEN;
  if (ORIGINAL_ENV_FILE === undefined) delete process.env['CONFIG_UI_ENV_FILE'];
  else process.env['CONFIG_UI_ENV_FILE'] = ORIGINAL_ENV_FILE;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test('blank tag fields remain empty rather than becoming tag zero', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  const envFile = await tempEnv('RADARR_TAGS=4\nSONARR_TAGS=8\n');
  process.env['CONFIG_UI_ENV_FILE'] = envFile;
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const currentResponse = await fetch(`${baseUrl}/api/config`, {
      headers: { cookie: session.cookie }
    });
    const current = (await currentResponse.json()) as { csrf: string; config: Record<string, any> };
    current.config.radarr.tags = '   ';
    current.config.sonarr.tags = '';
    current.config.radarr.apiKey = '';
    current.config.sonarr.apiKey = '';
    current.config.trakt.clientId = '';
    current.config.trakt.clientSecret = '';
    current.config.trakt.refreshToken = '';
    current.config.tmdb.authToken = '';

    const saveResponse = await fetch(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/json',
        'x-csrf-token': current.csrf
      },
      body: JSON.stringify(current.config)
    });
    assert.equal(saveResponse.status, 200, await saveResponse.text());

    const saved = await fs.readFile(envFile, 'utf8');
    assert.match(saved, /^RADARR_TAGS=$/m);
    assert.match(saved, /^SONARR_TAGS=$/m);
    assert.ok(!saved.includes('RADARR_TAGS=0'));
    assert.ok(!saved.includes('SONARR_TAGS=0'));
  });
});

test('malformed percent-encoded cookies fail authentication without crashing', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/config`, {
      headers: { cookie: 'addarr_config_session=%' }
    });
    assert.equal(response.status, 401);
    const body = (await response.json()) as { error: string };
    assert.equal(body.error, 'authentication_required');
  });
});


test('probe credentials are reused only for the configured origin', () => {
  assert.equal(
    credentialForProbeOrigin('http://radarr.local/api', '', 'http://radarr.local', 'stored-secret'),
    'stored-secret'
  );
  assert.equal(
    credentialForProbeOrigin('http://other.local', '', 'http://radarr.local', 'stored-secret'),
    ''
  );
  assert.equal(
    credentialForProbeOrigin('http://other.local', 'fresh-secret', 'http://radarr.local', 'stored-secret'),
    'fresh-secret'
  );
});

test('enabled configuration UI accepts an eight-character administrator token', () => {
  process.env['CONFIG_UI_TOKEN'] = 'a1B2_c3D';
  assert.doesNotThrow(() => createApp(uiConfig()));
});

test('enabled configuration UI rejects an administrator token shorter than eight characters', () => {
  process.env['CONFIG_UI_TOKEN'] = 'abcdefg';
  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be 8-128 URL-safe characters/);
});

test('authenticated control routes are rate limited per session', async () => {
  const cfg = uiConfig();
  const token = 'correct-horse-battery-staple';
  const envFile = await tempEnv();
  const app = express();
  const statusService = {
    getServiceHealth: async () => ({
      radarr: { configured: false, reachable: false, detail: 'disabled' },
      sonarr: { configured: false, reachable: false, detail: 'disabled' }
    })
  };
  app.use(createConfigUiRouter(cfg, statusService as never, createLogger('none'), {
    adminToken: token,
    envFilePath: envFile,
    controlRateLimitMax: 1
  }));

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, token);
    const headers = {
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf
    };
    const first = await fetch(`${baseUrl}/api/config/test/unsupported`, {
      method: 'POST', headers, body: '{}'
    });
    assert.equal(first.status, 404);
    const second = await fetch(`${baseUrl}/api/config/test/unsupported`, {
      method: 'POST', headers, body: '{}'
    });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: 'control_rate_limit_exceeded' });
  });
});
