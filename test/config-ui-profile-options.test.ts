import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Script } from 'node:vm';
import { createApp } from '../src/index.js';
import { baseConfig, withServer } from './_helpers.js';

const ORIGINAL_FETCH = globalThis.fetch;
const ORIGINAL_TOKEN = process.env['CONFIG_UI_TOKEN'];
const ORIGINAL_ENV_FILE = process.env['CONFIG_UI_ENV_FILE'];

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
  return { cookie, csrf: body.csrf };
}

test.afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH;
  if (ORIGINAL_TOKEN === undefined) delete process.env['CONFIG_UI_TOKEN'];
  else process.env['CONFIG_UI_TOKEN'] = ORIGINAL_TOKEN;
  if (ORIGINAL_ENV_FILE === undefined) delete process.env['CONFIG_UI_ENV_FILE'];
  else process.env['CONFIG_UI_ENV_FILE'] = ORIGINAL_ENV_FILE;
});

test('Configure client renders named Arr profiles while preserving numeric IDs', async () => {
  const source = await fs.readFile(path.resolve('assets/configure.js'), 'utf8');

  assert.doesNotThrow(() => new Script(source));
  assert.match(source, /return `\$\{name\} \[\$\{item\.id\}\]`;/);
  assert.match(source, /Unavailable profile \[\$\{selectedProfile\}\]/);
  assert.match(source, /Unavailable profile \[\$\{selectedLanguage\}\]/);
  assert.match(source, /if \(page === 'arr'\) void discoverConfiguredArrOptions\(\);/);
  assert.match(source, /Test connection & refresh options/);
  assert.match(source, /if \(existing && !force\) return existing;/);
  assert.match(source, /function discoveryInputMatches\(service, baseUrl, apiKey\)/);
  assert.match(source, /generation !== discoveryGeneration \|\| !discoveryInputMatches\(service, baseUrl, apiKey\)/);
  assert.match(source, /qualityProfileId: readNumber\('radarr-profile'\)/);
  assert.match(source, /qualityProfileId: readNumber\('sonarr-profile'\)/);
});

test('Arr discovery returns every named profile and reuses stored same-origin credentials server-side', async () => {
  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';
  delete process.env['CONFIG_UI_ENV_FILE'];

  const cfg = baseConfig();
  cfg.configUiEnabled = true;
  const seenKeys = new Map<string, string[]>();

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const parsed = new URL(String(input));
    const service = parsed.hostname.startsWith('radarr') ? 'radarr' : 'sonarr';
    const headers = new Headers(init?.headers);
    const serviceKeys = seenKeys.get(service) ?? [];
    serviceKeys.push(headers.get('x-api-key') ?? '');
    seenKeys.set(service, serviceKeys);

    if (parsed.pathname === '/api/v3/rootfolder') {
      return new Response(JSON.stringify([{ id: 1, path: service === 'radarr' ? '/movies' : '/tv' }]), { status: 200 });
    }
    if (parsed.pathname === '/api/v3/qualityprofile') {
      return new Response(JSON.stringify(service === 'radarr'
        ? [
            { id: 1, name: 'Any' },
            { id: 7, name: 'HD-1080p' },
            { id: 9, name: 'Ultra-HD' }
          ]
        : [
            { id: 1, name: 'Any' },
            { id: 4, name: 'HD-1080p' }
          ]), { status: 200 });
    }
    if (parsed.pathname === '/api/v3/tag') {
      return new Response('[]', { status: 200 });
    }
    if (parsed.pathname === '/api/v3/languageprofile') {
      return new Response(JSON.stringify([
        { id: 1, name: 'English' },
        { id: 2, name: 'Original Language' }
      ]), { status: 200 });
    }
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, process.env['CONFIG_UI_TOKEN']!);
    const headers = {
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf
    };

    const radarrResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config/options/radarr`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseUrl: cfg.radarr.baseUrl, apiKey: '' })
    });
    assert.equal(radarrResponse.status, 200);
    const radarr = (await radarrResponse.json()) as {
      qualityProfiles: Array<{ id: number; name: string }>;
    };
    assert.deepEqual(radarr.qualityProfiles, [
      { id: 1, name: 'Any' },
      { id: 7, name: 'HD-1080p' },
      { id: 9, name: 'Ultra-HD' }
    ]);

    const sonarrResponse = await ORIGINAL_FETCH(`${baseUrl}/api/config/options/sonarr`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ baseUrl: cfg.sonarr.baseUrl, apiKey: '' })
    });
    assert.equal(sonarrResponse.status, 200);
    const sonarr = (await sonarrResponse.json()) as {
      qualityProfiles: Array<{ id: number; name: string }>;
      languageProfiles: Array<{ id: number; name: string }>;
    };
    assert.deepEqual(sonarr.qualityProfiles, [
      { id: 1, name: 'Any' },
      { id: 4, name: 'HD-1080p' }
    ]);
    assert.deepEqual(sonarr.languageProfiles, [
      { id: 1, name: 'English' },
      { id: 2, name: 'Original Language' }
    ]);
  });

  assert.ok((seenKeys.get('radarr')?.length ?? 0) > 0);
  assert.ok(seenKeys.get('radarr')?.every((key) => key === cfg.radarr.apiKey));
  assert.ok((seenKeys.get('sonarr')?.length ?? 0) > 0);
  assert.ok(seenKeys.get('sonarr')?.every((key) => key === cfg.sonarr.apiKey));
});
