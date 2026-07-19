import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const helper = readFileSync(path.join(root, 'scripts/trakt-device-auth.mjs'), 'utf8');
const envExample = readFileSync(path.join(root, '.env.example'), 'utf8');
const traktGuide = readFileSync(path.join(root, 'docs/TRAKT.md'), 'utf8');

test('Trakt helper derives a beginner redirect suggestion from PUBLIC_BASE_URL', () => {
  assert.match(helper, /values\.get\('PUBLIC_BASE_URL'\)/);
  assert.match(helper, /\$\{parsed\.origin\}\/trakt\/callback/);
  assert.match(helper, /Set the Redirect URI to exactly/);
  assert.match(helper, /press Enter for the recommended default/);
});

test('Trakt setup preserves existing redirect values and explains Caddy behaviour', () => {
  assert.match(helper, /Existing values such as urn:ietf:wg:oauth:2\.0:oob remain supported/);
  assert.match(helper, /Do not add a Caddy route, rewrite or callback handler/);
  assert.match(helper, /Device Code Flow does not open or call \/trakt\/callback/);
});

test('environment example and beginner guide use the DuckDNS HTTPS pattern without implying a callback service', () => {
  assert.match(envExample, /https:\/\/myaddarr\.duckdns\.org\/trakt\/callback/);
  assert.match(envExample, /no Caddy route\/rewrite is/);
  assert.match(envExample, /urn:ietf:wg:oauth:2\.0:oob remain/);
  assert.match(traktGuide, /Beginner setup: DuckDNS and Caddy/);
  assert.match(traktGuide, /You do \*\*not\*\* need to add a Caddy route/);
  assert.match(traktGuide, /Existing OOB applications/);
  assert.match(traktGuide, /What to enter at each prompt/);
});
