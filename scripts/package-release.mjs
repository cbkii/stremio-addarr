import { execSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
rmSync('dist/release-tmp', { recursive: true, force: true });
mkdirSync('dist/release-tmp', { recursive: true });

execSync('tar -czf dist/stremio-addarr-source.tar.gz --exclude=.git --exclude=node_modules .', {
  stdio: 'inherit'
});
execSync('cp -r dist/src dist/release-tmp/src', { stdio: 'inherit' });
execSync(
  'tar -czf dist/stremio-addarr-bundle.tar.gz -C dist/release-tmp src -C ../.. package.json package-lock.json README.md .env.example Caddyfile.example',
  {
  stdio: 'inherit'
  }
);
execSync('(cd dist && sha256sum stremio-addarr-source.tar.gz stremio-addarr-bundle.tar.gz > checksums.txt)', {
  stdio: 'inherit'
});
rmSync('dist/release-tmp', { recursive: true, force: true });
