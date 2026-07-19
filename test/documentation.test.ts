import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function read(path: string): string {
  return readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

test('release template verifies current protected endpoints', () => {
  const template = read('.github/release-body.md.tmpl');

  assert.match(template, /127\.0\.0\.1:7010\/healthz/);
  assert.match(template, /127\.0\.0\.1:7010\/status\.json/);
  assert.match(template, /YOUR_ADDON_ACCESS_TOKEN\/manifest\.json/);
  assert.match(template, /YOUR_ADDON_ACCESS_TOKEN\/configure/);
  assert.doesNotMatch(template, /\$PUBLIC_BASE_URL\/manifest\.json/);
  assert.doesNotMatch(template, /127\.0\.0\.1:7010\/manifest\.json/);
});

test('README is an end-user entry point and delegates detailed guidance', () => {
  const readme = read('README.md');
  const contributing = read('CONTRIBUTING.md');

  const targets = [
    'README_HOST.md',
    'docs/CONFIGURATION.md',
    'docs/CONFIGURATION_UI.md',
    'docs/TROUBLESHOOTING.md',
    'docs/TRAKT.md',
    'CONTRIBUTING.md'
  ];
  for (const target of targets) {
    assert.ok(readme.includes(target), 'README.md should reference ' + target);
  }

  assert.doesNotMatch(readme, /npm run dev/);
  assert.match(contributing, /npm run dev/);
  assert.match(contributing, /npm run ci/);
  assert.match(contributing, /npm run package:release/);
});

test('release archive requires the split end-user guides', () => {
  const packager = read('scripts/package-release.mjs');

  for (const guide of [
    'docs/CONFIGURATION.md',
    'docs/CONFIGURATION_UI.md',
    'docs/TROUBLESHOOTING.md',
    'docs/TRAKT.md'
  ]) {
    assert.match(packager, new RegExp(guide.replaceAll('.', '\\.')));
  }
});

test('Trakt beginner documentation matches the supported DuckDNS and Caddy flow', () => {
  const readme = read('README.md');
  const envExample = read('.env.example');
  const traktGuide = read('docs/TRAKT.md');

  assert.match(readme, /bash quick\.sh trakt/);
  assert.match(envExample, /https:\/\/myaddarr\.duckdns\.org\/trakt\/callback/);
  assert.match(envExample, /no Caddy route\/rewrite is/);
  assert.match(envExample, /urn:ietf:wg:oauth:2\.0:oob remain/);
  assert.match(traktGuide, /Beginner setup: DuckDNS and Caddy/);
  assert.match(traktGuide, /You do \*\*not\*\* need to add a Caddy route/);
  assert.match(traktGuide, /Existing OOB applications/);
  assert.match(traktGuide, /What to enter at each prompt/);
});
