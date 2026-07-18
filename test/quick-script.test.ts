import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quick = readFileSync(path.join(root, 'quick.sh'), 'utf8');

test('quick.sh has valid Bash syntax', () => {
  assert.doesNotThrow(() => execFileSync('bash', ['-n', 'quick.sh'], { cwd: root, stdio: 'pipe' }));
});

test('quick.sh exposes protected URLs and an exact-eight token flow', () => {
  assert.match(quick, /openssl rand -base64 6/);
  assert.match(quick, /specify exactly 8 characters/);
  assert.match(quick, /\{8,128\}/);
  assert.match(quick, /\{8\}/);
  assert.match(quick, /PUBLIC_MANIFEST_URL=.*ADDON_ACCESS_TOKEN.*manifest\.json/);
  assert.match(quick, /PUBLIC_CONFIGURE_URL=.*ADDON_ACCESS_TOKEN.*configure/);
});

test('quick.sh safely handles a missing environment file', () => {
  assert.match(quick, /\[\[ -f "\$INSTALL_DIR\/\.env" \]\] \|\|/);
});

test('quick.sh exposes retryable standalone Trakt device authentication', () => {
  const helper = readFileSync(path.join(root, 'scripts/trakt-device-auth.mjs'), 'utf8');
  assert.match(quick, /bash quick\.sh trakt/);
  assert.match(quick, /trakt-device-auth\.mjs/);
  assert.match(helper, /requestTraktDeviceCode/);
  assert.match(helper, /pollTraktDeviceToken/);
  assert.match(helper, /retry refresh/);
  assert.match(helper, /new device code/);
  assert.match(helper, /Invalid URL format/);
  assert.match(helper, /Use only the API origin/);
  assert.doesNotMatch(quick + helper, /oauth\/authorize/);
  assert.doesNotMatch(quick + helper, /urn:ietf:wg:oauth:2\.0:oob/);
  assert.doesNotThrow(() => execFileSync('node', ['--check', 'scripts/trakt-device-auth.mjs'], { cwd: root, stdio: 'pipe' }));
});
