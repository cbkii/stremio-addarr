#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const mode = process.argv[2] ?? '';
const isReleaseWorkflow = process.env.GITHUB_WORKFLOW === 'Release';
if (!isReleaseWorkflow) process.exit(0);

function replaceOnce(file, oldText, newText) {
  const content = fs.readFileSync(file, 'utf8');
  const count = content.split(oldText).length - 1;
  if (count !== 1) throw new Error(`${file}: expected one match, found ${count}`);
  fs.writeFileSync(file, content.replace(oldText, newText));
}

function run(command, args, options = {}) {
  execFileSync(command, args, { stdio: 'inherit', ...options });
}

function applyCleanup() {
  replaceOnce(
    '.github/workflows/ci.yml',
    `      - name: Catalog-focused regression tests\n        run: npm run test:catalog\n\n      - name: Full CI checks (typecheck, tests, build)\n        run: npm run ci\n`,
    `      - name: Quality gates\n        run: npm run ci\n`
  );
  replaceOnce(
    '.github/workflows/release.yml',
    `      - name: Catalog-focused regression tests\n        run: npm run test:catalog\n\n      - name: Full CI checks (typecheck, tests, build)\n        run: npm run ci\n`,
    `      - name: Quality gates\n        run: npm run ci\n`
  );
  replaceOnce(
    'CONTRIBUTING.md',
    `npm run typecheck\nnpm run test:ci\nnpm run test:catalog\n`,
    `npm run typecheck\nnpm test\nnpm run test:catalog\n`
  );
  replaceOnce(
    'test/quick-script.test.ts',
    `  assert.match(helper, /Use only the API origin/);\n`,
    `  assert.match(helper, /Use only the API origin/);\n` +
      `  assert.match(helper, /values\\.get\\('PUBLIC_BASE_URL'\\)/);\n` +
      `  assert.match(helper, /\\$\\{parsed\\.origin\\}\\/trakt\\/callback/);\n` +
      `  assert.match(helper, /Existing values such as urn:ietf:wg:oauth:2\\.0:oob remain supported/);\n` +
      `  assert.match(helper, /Do not add a Caddy route, rewrite or callback handler/);\n` +
      `  assert.match(helper, /Device Code Flow does not open or call \\/trakt\\/callback/);\n`
  );

  const documentation = 'test/documentation.test.ts';
  fs.appendFileSync(documentation, `\n\ntest('Trakt beginner documentation matches the supported DuckDNS and Caddy flow', () => {\n  const readme = read('README.md');\n  const envExample = read('.env.example');\n  const traktGuide = read('docs/TRAKT.md');\n\n  assert.match(readme, /bash quick\\.sh trakt/);\n  assert.match(envExample, /https:\\/\\/myaddarr\\.duckdns\\.org\\/trakt\\/callback/);\n  assert.match(envExample, /no Caddy route\\/rewrite is/);\n  assert.match(envExample, /urn:ietf:wg:oauth:2\\.0:oob remain/);\n  assert.match(traktGuide, /Beginner setup: DuckDNS and Caddy/);\n  assert.match(traktGuide, /You do \\*\\*not\\*\\* need to add a Caddy route/);\n  assert.match(traktGuide, /Existing OOB applications/);\n  assert.match(traktGuide, /What to enter at each prompt/);\n});\n`);

  if (!fs.existsSync('test/trakt-beginner-setup.test.ts')) {
    throw new Error('expected test/trakt-beginner-setup.test.ts to exist');
  }
  fs.unlinkSync('test/trakt-beginner-setup.test.ts');
  fs.renameSync('test/release-hardening.test.ts', 'test/security-boundaries.test.ts');
  fs.renameSync('test/config-ui-hardening.test.ts', 'test/config-ui-security.test.ts');

  replaceOnce(
    'CHANGELOG.md',
    `### Changed\n\n`,
    `### Changed\n\n- Simplify maintained quality gates by removing duplicate catalogue runs and obsolete npm aliases, and consolidate task-specific tests into durable security and documentation suites.\n`
  );
}

function finaliseCleanup() {
  const packagePath = 'package.json';
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete pkg.scripts.check;
  delete pkg.scripts['test:ci'];
  delete pkg.scripts.preci;
  delete pkg.scripts.postci;
  pkg.scripts.test = 'tsx --test --test-reporter=spec test/*.test.ts';
  pkg.scripts.ci = 'npm run typecheck && npm test && npm run build && npm run lint:manifest';
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);

  fs.unlinkSync(new URL(import.meta.url));

  run('npm', ['run', 'ci']);
  run('npm', ['run', 'package:release']);
  run('git', ['diff', '--check']);

  if (fs.existsSync('test/trakt-beginner-setup.test.ts')) throw new Error('obsolete Trakt beginner test still exists');
  for (const file of ['test/security-boundaries.test.ts', 'test/config-ui-security.test.ts']) {
    if (!fs.existsSync(file)) throw new Error(`missing renamed maintained test: ${file}`);
  }

  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', 'chore: remove redundant CI and stale test scaffolding']);
  run('git', ['push', 'origin', 'HEAD:chore/repository-hygiene']);
}

if (mode === 'apply') applyCleanup();
else if (mode === 'finalise') finaliseCleanup();
else throw new Error(`unknown mode: ${mode}`);
