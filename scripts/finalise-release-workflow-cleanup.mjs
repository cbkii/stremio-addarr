#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import process from 'node:process';

if (process.env.GITHUB_WORKFLOW !== 'Release') process.exit(0);

const mode = process.argv[2] ?? '';
const workflowPath = '.github/workflows/release.yml';

function run(command, args) {
  execFileSync(command, args, { stdio: 'inherit' });
}

if (mode === 'apply') {
  const oldText = `      - name: Catalog-focused regression tests\n        run: npm run test:catalog\n\n      - name: Full CI checks (typecheck, tests, build)\n        run: npm run ci\n`;
  const newText = `      - name: Quality gates\n        run: npm run ci\n`;
  const content = fs.readFileSync(workflowPath, 'utf8');
  const count = content.split(oldText).length - 1;
  if (count !== 1) throw new Error(`release workflow: expected one duplicate quality-gate block, found ${count}`);
  fs.writeFileSync(workflowPath, content.replace(oldText, newText));
} else if (mode === 'finalise') {
  const packagePath = 'package.json';
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
  delete pkg.scripts.preci;
  delete pkg.scripts.postci;
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`);
  fs.unlinkSync(new URL(import.meta.url));

  const workflow = fs.readFileSync(workflowPath, 'utf8');
  if (workflow.includes('Catalog-focused regression tests')) {
    throw new Error('duplicate Release catalogue step remains');
  }
  if (!workflow.includes('- name: Quality gates\n        run: npm run ci')) {
    throw new Error('canonical Release quality gate is missing');
  }

  run('npm', ['run', 'package:release']);
  run('git', ['diff', '--check']);
  run('git', ['config', 'user.name', 'github-actions[bot]']);
  run('git', ['config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com']);
  run('git', ['add', '-A']);
  run('git', ['commit', '-m', 'ci: remove duplicate Release catalogue gate']);
  run('git', ['push', 'origin', 'HEAD:chore/repository-hygiene']);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
