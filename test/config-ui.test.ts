import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/index.js';
import { addonUrl, baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env['CONFIG_UI_TOKEN'];
const ORIGINAL_ENV_FILE = process.env['CONFIG_UI_ENV_FILE'];
const tempDirs: string[] = [];

function uiConfig() {
  const cfg = baseConfig();
  cfg.configUiEnabled = true;
  return cfg;
}

async function tempEnv(initial = '# operator-owned comment\nPUBLIC_BASE_URL=https://example.invalid\n'): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'addarr-config-ui-'));
  tempDirs.push(dir);
  const envFile = path.join(dir, '.env');
  await fs.writeFile(envFile, initial, { mode: 0o600 });
  return envFile;
}

async function login(baseUrl: string, token: string): Promise<{ cookie: string; csrf: string }> {
  const response = await ORIGINAL_FETCH(`${baseUrl}/api/config/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ token })
  });
  assert.equal(response.status, 200);
  const body = (await response.json()) as { csrf: string };
  const cookie = response.headers.get('set-cookie')?.split(';')[0] ?? '';
  assert.ok(cookie.startsWith('addarr_config_session='));
  assert.ok(body.csrf.length > 20);
  return { cookie, csrf: body.csrf };
}

test.afterEach(async () => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_TOKEN === undefined) delete process.env['CONFIG_UI_TOKEN'];
  else process.env['CONFIG_UI_TOKEN'] = ORIGINAL_TOKEN;
  if (ORIGINAL_ENV_FILE === undefined) delete process.env['CONFIG_UI_ENV_FILE'];
  else process.env['CONFIG_UI_ENV_FILE'] = ORIGINAL_ENV_FILE;
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

test('manifest advertises Stremio configuration without making it mandatory', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  const cfg = uiConfig();
  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${addonUrl(baseUrl, cfg)}/manifest.json`);
    const manifest = (await response.json()) as { behaviorHints?: { configurable?: boolean; configurationRequired?: boolean } };
    assert.equal(response.status, 200);
    assert.equal(manifest.behaviorHints?.configurable, true);
    assert.equal(manifest.behaviorHints?.configurationRequired, false);
  });
});

test('/configure serves a TV-first page without exposing configured secrets', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const response = await ORIGINAL_FETCH(`${baseUrl}/configure`);
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);
    assert.match(html, /Arr Status &amp; Add/);
    assert.match(html, /Unlock configuration/);
    assert.match(html, /\/assets\/configure\.js/);
    assert.ok(!html.includes('value="radarr-key"'));
    assert.ok(!html.includes('value="sonarr-key"'));
  });
});

test('configuration API requires authentication and rejects a wrong token', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const unauthenticated = await ORIGINAL_FETCH(`${baseUrl}/api/config`);
    assert.equal(unauthenticated.status, 401);

    const rejected = await ORIGINAL_FETCH(`${baseUrl}/api/config/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'wrong-token' })
    });
    assert.equal(rejected.status, 401);
  });
});

test('authenticated configuration response is redacted and reports secret presence only', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv('RADARR_API_KEY=persisted-secret\nSONARR_API_KEY=another-secret\n');
  const cfg = uiConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const response = await ORIGINAL_FETCH(`${baseUrl}/api/config`, { headers: { cookie: session.cookie } });
    const text = await response.text();
    assert.equal(response.status, 200);
    assert.ok(!text.includes('persisted-secret'));
    assert.ok(!text.includes('another-secret'));
    assert.ok(!text.includes('radarr-key'));
    const body = JSON.parse(text) as { config: { radarr: { apiKeyConfigured: boolean }; sonarr: { apiKeyConfigured: boolean } } };
    assert.equal(body.config.radarr.apiKeyConfigured, true);
    assert.equal(body.config.sonarr.apiKeyConfigured, true);
  });
});

test('save validates and atomically updates only managed environment keys', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  const envFile = await tempEnv('# preserve me\nPUBLIC_BASE_URL=https://example.invalid\nUNRELATED_SETTING=keep-this\nRADARR_ENABLED=false\nRADARR_ENABLED=false\n');
  process.env['CONFIG_UI_ENV_FILE'] = envFile;
  const cfg = uiConfig();
  const app = createApp(cfg);

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const currentResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config`, { headers: { cookie: session.cookie } });
    const current = (await currentResponse.json()) as { csrf: string; config: Record<string, any> };

    const payload = current.config;
    payload.radarr.enabled = true;
    payload.radarr.baseUrl = 'http://127.0.0.1:7878/';
    payload.radarr.cardUrl = '';
    payload.radarr.apiKey = 'new-radarr-secret';
    payload.radarr.rootFolderPath = '/media/movies';
    payload.radarr.qualityProfileId = 7;
    payload.radarr.tags = '1,3';
    payload.sonarr.apiKey = '';
    payload.trakt.clientId = '';
    payload.trakt.clientSecret = '';
    payload.trakt.refreshToken = '';
    payload.tmdb.authToken = '';

    const response = await ORIGINAL_FETCH(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: {
        cookie: session.cookie,
        'content-type': 'application/json',
        'x-csrf-token': current.csrf
      },
      body: JSON.stringify(payload)
    });
    const resultText = await response.text();
    assert.equal(response.status, 200, resultText);
    assert.ok(!resultText.includes('new-radarr-secret'));

    const saved = await fs.readFile(envFile, 'utf8');
    assert.match(saved, /# preserve me/);
    assert.match(saved, /UNRELATED_SETTING=keep-this/);
    assert.match(saved, /PUBLIC_BASE_URL=https:\/\/example\.invalid/);
    assert.equal((saved.match(/^RADARR_ENABLED=true$/gm) ?? []).length, 2);
    assert.ok(!saved.includes('RADARR_ENABLED=false'));
    assert.match(saved, /RADARR_BASE_URL=http:\/\/127\.0\.0\.1:7878/);
    assert.match(saved, /RADARR_API_KEY=new-radarr-secret/);
    assert.match(saved, /RADARR_QUALITY_PROFILE_ID=7/);
    assert.match(saved, /RADARR_TAGS=1,3/);

    const stat = await fs.stat(envFile);
    assert.equal(stat.mode & 0o777, 0o600);
    const backup = await fs.readFile(`${envFile}.bak`, 'utf8');
    assert.match(backup, /UNRELATED_SETTING=keep-this/);

    const redacted = await ORIGINAL_FETCH(`${baseUrl}/api/config`, { headers: { cookie: session.cookie } });
    const redactedText = await redacted.text();
    assert.ok(!redactedText.includes('new-radarr-secret'));
  });
});

test('save requires CSRF token', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();
  const app = createApp(uiConfig());

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const response = await ORIGINAL_FETCH(`${baseUrl}/api/config`, {
      method: 'PUT',
      headers: { cookie: session.cookie, 'content-type': 'application/json' },
      body: '{}'
    });
    assert.equal(response.status, 403);
  });
});

test('Arr connection test and option discovery use candidate credentials without returning them', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();
  const cfg = uiConfig();
  const seenKeys: string[] = [];

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(input));
    const headers = new Headers(init?.headers);
    seenKeys.push(headers.get('x-api-key') ?? '');
    if (parsed.pathname === '/api/v3/system/status') {
      return new Response('{"appName":"Radarr","version":"6.0.0"}', { status: 200 });
    }
    if (parsed.pathname === '/api/v3/rootfolder') {
      return new Response('[{"id":1,"path":"/media/movies"}]', { status: 200 });
    }
    if (parsed.pathname === '/api/v3/qualityprofile') {
      return new Response('[{"id":7,"name":"HD-1080p"}]', { status: 200 });
    }
    if (parsed.pathname === '/api/v3/tag') {
      return new Response('[{"id":3,"label":"stremio"}]', { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const body = JSON.stringify({ baseUrl: 'http://radarr.local', apiKey: 'candidate-key' });
    const commonHeaders = {
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf
    };

    const testResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config/test/radarr`, { method: 'POST', headers: commonHeaders, body });
    const testText = await testResponse.text();
    assert.equal(testResponse.status, 200, testText);
    assert.ok(!testText.includes('candidate-key'));

    const optionsResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config/options/radarr`, { method: 'POST', headers: commonHeaders, body });
    const options = (await optionsResponse.json()) as { rootFolders: Array<{ path: string }>; qualityProfiles: Array<{ name: string }> };
    assert.equal(optionsResponse.status, 200);
    assert.equal(options.rootFolders[0]?.path, '/media/movies');
    assert.equal(options.qualityProfiles[0]?.name, 'HD-1080p');
    assert.ok(seenKeys.length >= 4);
    assert.ok(seenKeys.every((key) => key === 'candidate-key'));
  });
});
