import express from 'express';
import { getRouter } from 'stremio-addon-sdk';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { renderActionResultPage, renderLandingPage } from './ui/landing.js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const { addonInterface, statusService } = createAddonInterface(config);

// Log startup validation warnings
for (const warning of config.publicUrlValidation.warnings) {
  logger.warn(warning);
}
if (config.radarr.enabled && !config.radarr.rootFolderPath) {
  logger.warn('RADARR_ROOT_FOLDER_PATH is not set. Add actions will fail.');
}
if (config.sonarr.enabled && !config.sonarr.rootFolderPath) {
  logger.warn('SONARR_ROOT_FOLDER_PATH is not set. Add actions will fail.');
}

// Resolve package.json version
let addonVersion = '1.0.0';
try {
  const pkgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version?: string };
  addonVersion = pkg.version ?? addonVersion;
} catch {
  // ignore
}

const app = express();
app.disable('x-powered-by');

// Liveness probe
app.get('/healthz', (_req, res) => {
  res.json({ ok: true });
});

// Back-compat alias
app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Detailed diagnostics endpoint
app.get('/status.json', async (_req, res) => {
  const radarrReachable = config.radarr.enabled
    ? await statusService.getRadarrClient().ping()
    : null;
  const sonarrReachable = config.sonarr.enabled
    ? await statusService.getSonarrClient().ping()
    : null;

  const redactUrl = (url: string): string => {
    try {
      const u = new URL(url);
      return `${u.protocol}//${u.hostname}:${u.port || (u.protocol === 'https:' ? '443' : '80')}`;
    } catch {
      return '[invalid url]';
    }
  };

  res.json({
    name: 'stremio-addarr',
    version: addonVersion,
    bindHost: config.host,
    bindPort: config.port,
    publicBaseUrl: config.publicBaseUrl,
    isHttps: config.publicUrlValidation.isHttps,
    corsActive: true,
    warnings: config.publicUrlValidation.warnings,
    radarr: {
      enabled: config.radarr.enabled,
      reachable: radarrReachable,
      baseUrl: config.radarr.enabled ? redactUrl(config.radarr.baseUrl) : null,
      rootFolderConfigured: config.radarr.enabled ? !!config.radarr.rootFolderPath : null,
      qualityProfileId: config.radarr.enabled ? config.radarr.qualityProfileId : null
    },
    sonarr: {
      enabled: config.sonarr.enabled,
      reachable: sonarrReachable,
      baseUrl: config.sonarr.enabled ? redactUrl(config.sonarr.baseUrl) : null,
      rootFolderConfigured: config.sonarr.enabled ? !!config.sonarr.rootFolderPath : null,
      qualityProfileId: config.sonarr.enabled ? config.sonarr.qualityProfileId : null,
      languageProfileId: config.sonarr.enabled ? config.sonarr.languageProfileId : null
    },
    settings: {
      requestTimeoutMs: config.requestTimeoutMs,
      statusCacheTtlMs: config.statusCacheTtlMs,
      actionConfirm: config.actionConfirm
    }
  });
});

app.get('/action/:kind/:encodedId', async (req, res) => {
  const kind = req.params.kind;
  if (kind !== 'movie' && kind !== 'series') {
    res.status(400).send('Unsupported action kind.');
    return;
  }

  try {
    const rawId = decodeURIComponent(req.params.encodedId);
    const parsed = parseStremioId(kind, rawId);
    const result = await statusService.triggerAdd(parsed);
    const returnLink = statusService.buildReturnLink(parsed);
    res.type('html').send(renderActionResultPage(result, returnLink));
  } catch (error) {
    logger.error('Action request failed', {
      error: error instanceof Error ? error.message : String(error),
      kind,
      encodedId: req.params.encodedId
    });
    res
      .status(500)
      .type('html')
      .send(
        renderActionResultPage(
          {
            ok: false,
            service: kind === 'movie' ? 'radarr' : 'sonarr',
            title: 'Action failed',
            summary: 'The add action could not be completed.',
            detail: error instanceof Error ? error.message : 'Unknown error.'
          },
          '/'
        )
      );
  }
});

app.get('/', (_req, res) => {
  res.type('html').send(renderLandingPage(config));
});

app.use('/', getRouter(addonInterface));

app.listen(config.port, config.host, () => {
  logger.info('Server started', {
    host: config.host,
    port: config.port,
    manifest: `${config.publicBaseUrl}/manifest.json`
  });
});
