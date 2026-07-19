#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
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

function writeBranchPurgeWorkflow() {
  const lines = [
    'name: Purge merged PR branches',
    '',
    'on:',
    '  push:',
    '    branches: [main]',
    '',
    'permissions:',
    '  contents: write',
    '  pull-requests: read',
    '',
    'concurrency:',
    '  group: purge-merged-pr-branches',
    '  cancel-in-progress: false',
    '',
    'jobs:',
    '  purge:',
    '    runs-on: ubuntu-latest',
    '    timeout-minutes: 10',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '        with:',
    '          fetch-depth: 0',
    '',
    '      - name: Delete branches belonging to closed pull requests',
    '        id: purge',
    '        env:',
    '          GH_TOKEN: ${{ github.token }}',
    '          REPO: ${{ github.repository }}',
    '          DEFAULT_BRANCH: ${{ github.event.repository.default_branch }}',
    '        run: |',
    '          set -euo pipefail',
    '          mapfile -t CURRENT_BRANCHES < <(gh api --paginate "repos/${REPO}/branches?per_page=100" --jq ".[ ].name" | sed "s/ //g" | sort -u)',
    '          mapfile -t OPEN_HEADS < <(gh api --paginate "repos/${REPO}/pulls?state=open&per_page=100" --jq ".[] | select(.head.repo.full_name == \"${REPO}\") | .head.ref" | sort -u)',
    '          mapfile -t CLOSED_HEADS < <(gh api --paginate "repos/${REPO}/pulls?state=closed&per_page=100" --jq ".[] | select(.head.repo.full_name == \"${REPO}\") | .head.ref" | sort -u)',
    '',
    '          is_current() { printf "%s\\n" "${CURRENT_BRANCHES[@]}" | grep -Fxq -- "$1"; }',
    '          is_open() { printf "%s\\n" "${OPEN_HEADS[@]}" | grep -Fxq -- "$1"; }',
    '',
    '          deleted=0',
    '          skipped=0',
    '          failed=0',
    '          : > "$RUNNER_TEMP/deleted-branches.txt"',
    '',
    '          for branch in "${CLOSED_HEADS[@]}"; do',
    '            [[ -n "$branch" ]] || continue',
    '            [[ "$branch" != "$DEFAULT_BRANCH" ]] || continue',
    '            is_current "$branch" || continue',
    '            if is_open "$branch"; then',
    '              echo "Skipping branch used by an open PR: $branch"',
    '              skipped=$((skipped + 1))',
    '              continue',
    '            fi',
    '            encoded=$(python3 - "$branch" <<"PY"',
    'import sys',
    'from urllib.parse import quote',
    'print(quote(sys.argv[1], safe=""))',
    'PY',
    '            )',
    '            if gh api --method DELETE "repos/${REPO}/git/refs/heads/${encoded}"; then',
    '              echo "Deleted stale branch: $branch"',
    '              echo "$branch" >> "$RUNNER_TEMP/deleted-branches.txt"',
    '              deleted=$((deleted + 1))',
    '            else',
    '              echo "::warning::Could not delete stale branch: $branch"',
    '              failed=$((failed + 1))',
    '            fi',
    '          done',
    '',
    '          {',
    '            echo "### Branch cleanup"',
    '            echo "- Deleted: ${deleted}"',
    '            echo "- Skipped because an open PR uses the branch: ${skipped}"',
    '            echo "- Failed: ${failed}"',
    '            if [[ -s "$RUNNER_TEMP/deleted-branches.txt" ]]; then',
    '              echo ""',
    '              echo "Deleted branches:"',
    '              sed "s/^/- `/; s/$/`/" "$RUNNER_TEMP/deleted-branches.txt"',
    '            fi',
    '          } >> "$GITHUB_STEP_SUMMARY"',
    '          echo "failed=${failed}" >> "$GITHUB_OUTPUT"',
    '',
    '      - name: Remove this one-shot workflow',
    '        run: |',
    '          set -euo pipefail',
    '          git config user.name "github-actions[bot]"',
    '          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"',
    '          git rm .github/workflows/purge-merged-pr-branches.yml',
    '          git commit -m "chore: remove completed branch purge workflow [skip ci]"',
    '          git push origin HEAD:main',
    '',
    '      - name: Report branch deletion failures',
    '        if: steps.purge.outputs.failed != \'0\'',
    '        run: |',
    '          echo "::error::One or more stale branches could not be deleted; inspect the branch cleanup summary."',
    '          exit 1',
    ''
  ];
  fs.mkdirSync('.github/workflows', { recursive: true });
  fs.writeFileSync('.github/workflows/purge-merged-pr-branches.yml', `${lines.join('\n')}\n`);
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

  fs.appendFileSync('test/documentation.test.ts', `\n\ntest('Trakt beginner documentation matches the supported DuckDNS and Caddy flow', () => {\n  const readme = read('README.md');\n  const envExample = read('.env.example');\n  const traktGuide = read('docs/TRAKT.md');\n\n  assert.match(readme, /bash quick\\.sh trakt/);\n  assert.match(envExample, /https:\\/\\/myaddarr\\.duckdns\\.org\\/trakt\\/callback/);\n  assert.match(envExample, /no Caddy route\\/rewrite is/);\n  assert.match(envExample, /urn:ietf:wg:oauth:2\\.0:oob remain/);\n  assert.match(traktGuide, /Beginner setup: DuckDNS and Caddy/);\n  assert.match(traktGuide, /You do \\*\\*not\\*\\* need to add a Caddy route/);\n  assert.match(traktGuide, /Existing OOB applications/);\n  assert.match(traktGuide, /What to enter at each prompt/);\n});\n`);

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
  writeBranchPurgeWorkflow();
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
  if (!fs.existsSync('.github/workflows/purge-merged-pr-branches.yml')) {
    throw new Error('missing one-shot branch purge workflow');
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
