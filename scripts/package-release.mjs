// scripts/package-release.mjs
// Produces exactly one install archive + one checksum file:
//   dist/stremio-addarr-install.tar.gz
//   dist/stremio-addarr-install.tar.gz.sha256

import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync } from 'node:fs';

const STAGING = 'dist/staging';
const ARCHIVE = 'dist/stremio-addarr-install.tar.gz';
const CHECKSUM = `${ARCHIVE}.sha256`;

// ── Pre-flight: verify all required files exist ──────────────────────────
const REQUIRED_FILES = [
  'dist/src/index.js',      // built runtime entry point
  'package.json',
  'package-lock.json',
  'README.md',
  'README_HOST.md',
  '.env.example',
  'Caddyfile.example',
  'docker-compose.example.yml',
  'deploy/stremio-addarr.service.example',
];

let preflight = true;
for (const f of REQUIRED_FILES) {
  if (!existsSync(f)) {
    console.error(`ERROR: Required file not found: ${f}`);
    if (f === 'dist/src/index.js') {
      console.error('       Run `npm run build` first.');
    }
    preflight = false;
  }
}
if (!preflight) process.exit(1);

// ── Clean previous artifacts ─────────────────────────────────────────────
rmSync(STAGING, { recursive: true, force: true });
for (const f of [ARCHIVE, CHECKSUM]) {
  rmSync(f, { force: true });
}
mkdirSync(STAGING, { recursive: true });

// ── Stage files into a clean directory tree ───────────────────────────────
const stage = (src, dest) => {
  const target = `${STAGING}/${dest ?? src}`;
  execSync(`mkdir -p "$(dirname "${target}")"`, { stdio: 'inherit' });
  execSync(`cp -r "${src}" "${target}"`, { stdio: 'inherit' });
};

// Built runtime
stage('dist/src', 'dist/src');

// Package manifests (for npm ci --omit=dev in install)
stage('package.json');
stage('package-lock.json');

// Documentation
stage('README.md');
stage('README_HOST.md');

// Config examples
stage('.env.example');
stage('Caddyfile.example');
stage('docker-compose.example.yml');

// Deploy helpers
stage('deploy', 'deploy');

// ── Create archive ────────────────────────────────────────────────────────
execSync(`tar -czf "${ARCHIVE}" -C "${STAGING}" .`, { stdio: 'inherit' });

// ── Create checksum ───────────────────────────────────────────────────────
execSync(
  `(cd dist && sha256sum stremio-addarr-install.tar.gz > stremio-addarr-install.tar.gz.sha256)`,
  { stdio: 'inherit' },
);

// ── Clean staging ─────────────────────────────────────────────────────────
rmSync(STAGING, { recursive: true, force: true });

console.log(`\n✅ Release assets ready:`);
console.log(`   ${ARCHIVE}`);
console.log(`   ${CHECKSUM}`);
