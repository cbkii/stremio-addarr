import { createRequire } from 'node:module';
import { createApp } from '../dist/src/index.js';

process.env.PUBLIC_BASE_URL = 'https://stremio-addarr.example.com';
process.env.ADDON_ACCESS_TOKEN = 'manifest-lint-access-token-0123456789abcdef';
process.env.CONFIG_UI_ENABLED = 'false';
process.env.RADARR_ENABLED = 'false';
process.env.SONARR_ENABLED = 'false';
const { loadConfig } = await import('../dist/src/config.js');
const config = loadConfig();
const app = createApp(config);
const server = await new Promise((resolve) => { const instance = app.listen(0, '127.0.0.1', () => resolve(instance)); });
try {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Could not resolve manifest lint server address');
  const response = await fetch(`http://127.0.0.1:${address.port}/${encodeURIComponent(config.addonAccessToken)}/manifest.json`);
  if (!response.ok) throw new Error(`Manifest endpoint returned HTTP ${response.status}`);
  const manifest = await response.json();
  const require = createRequire(import.meta.url);
  const linter = require('stremio-addon-linter');
  const result = linter.lintManifest(manifest);
  if (!result.valid) {
    console.error(JSON.stringify(result, null, 2));
    process.exitCode = 1;
  } else {
    console.log(JSON.stringify(result, null, 2));
  }
} finally {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
