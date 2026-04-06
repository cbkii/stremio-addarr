import express from 'express';
import sdk from 'stremio-addon-sdk';
import { loadConfig, validateConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import type { ParsedStremioId } from './types.js';

// Minimal valid HLS end-of-stream playlist. Stremio's player resolves this as a
// zero-duration stream that completes immediately — no browser is opened.
const EMPTY_HLS = '#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:1\n#EXT-X-ENDLIST\n';

function redactUrl(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname;
    if (host.length <= 4) {
      return rawUrl;
    }
    const redacted = `${host[0]}${'*'.repeat(host.length - 4)}${host.slice(-3)}`;
    const port = parsed.port ? `:${parsed.port}` : '';
    return `${parsed.protocol}//${redacted}${port}`;
  } catch {
    return '***';
  }
}

export function createApp(config: AppConfig) {
  const getRouter = (sdk as { getRouter: (addonInterface: unknown) => import('express').RequestHandler }).getRouter;
  const logger = createLogger(config.logLevel);
  const { addonInterface, statusService } = createAddonInterface(config);

  const app = express();
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start
      });
    });
    next();
  });

  app.use((req, res, next) => {
    const isStremioRoute = req.path === '/manifest.json' || req.path.startsWith('/stream/') || req.path.startsWith('/action/');
    if (isStremioRoute) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
      res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
    }
    next();
  });

  app.get('/health', async (_req, res) => {
    const serviceHealth = await statusService.getServiceHealth();
    res.json({
      ok: true,
      name: config.appName,
      version: config.version,
      manifest: `${config.publicBaseUrl}/manifest.json`,
      services: serviceHealth
    });
  });

  app.get('/healthz', (_req, res) => {
    const validation = validateConfig(config);
    res.json({
      ok: true,
      targetClient: validation.targetClient,
      likelyAndroidTvCompatible: validation.likelyAndroidTvCompatible,
      issues: validation.issues.filter((issue) => issue !== 'Neither Radarr nor Sonarr is enabled — add-on will show no useful tiles')
    });
  });

  app.get('/status.json', async (_req, res) => {
    const serviceHealth = await statusService.getServiceHealth();
    const validation = validateConfig(config);

    const configIssues = [...validation.issues];
    if (config.radarr.enabled && !serviceHealth.radarr.reachable && serviceHealth.radarr.detail !== 'disabled') {
      configIssues.push('Radarr enabled but unreachable');
    }
    if (config.sonarr.enabled && !serviceHealth.sonarr.reachable && serviceHealth.sonarr.detail !== 'disabled') {
      configIssues.push('Sonarr enabled but unreachable');
    }

    res.json({
      name: config.appName,
      version: config.version,
      host: config.host,
      port: config.port,
      bind: `${config.host}:${config.port}`,
      targetClient: validation.targetClient,
      publicBaseUrl: config.publicBaseUrl,
      publicBaseUrlIsHttps: validation.isHttps,
      publicBaseUrlHostnameIsIp: validation.isHostnameIp,
      publicBaseUrlHostnameIsInternal: validation.isInternalHostname,
      publicBaseUrlHasPathPrefix: validation.hasPathPrefix,
      likelyAndroidTvCompatible: validation.likelyAndroidTvCompatible,
      recommendedFrontDoor: validation.recommendedCaddyPublicCert
        ? 'Caddy reverse proxy with publicly trusted certificate on real DNS hostname'
        : 'configured origin looks Android-TV-safe',
      statusCacheTtlMs: config.statusCacheTtlMs,
      serviceHealthCacheTtlMs: config.serviceHealthCacheTtlMs,
      requestTimeoutMs: config.requestTimeoutMs,
      streamCacheMaxAge: config.streamCacheMaxAgeSec,
      streamStaleRevalidate: config.streamStaleRevalidateSec,
      radarr: {
        enabled: config.radarr.enabled,
        reachable: serviceHealth.radarr.reachable,
        detail: serviceHealth.radarr.detail,
        baseUrl: config.radarr.enabled ? redactUrl(config.radarr.baseUrl) : null
      },
      sonarr: {
        enabled: config.sonarr.enabled,
        reachable: serviceHealth.sonarr.reachable,
        detail: serviceHealth.sonarr.detail,
        baseUrl: config.sonarr.enabled ? redactUrl(config.sonarr.baseUrl) : null
      },
      configIssues
    });
  });

  app.get('/action/:action/:kind/:encodedId', (req, res) => {
    const action = req.params.action;
    const kind = req.params.kind;
    const encodedId = req.params.encodedId;

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');

    if (kind !== 'movie' && kind !== 'series') {
      logger.error('Action request with unsupported kind', { kind, action });
      res.send(EMPTY_HLS);
      return;
    }
    if (action !== 'search' && action !== 'add-search') {
      logger.error('Action request with unsupported action', { kind, action });
      res.send(EMPTY_HLS);
      return;
    }

    let parsed: ParsedStremioId;
    try {
      parsed = parseStremioId(kind, decodeURIComponent(encodedId));
    } catch (error) {
      logger.error('Action id parse error', {
        error: error instanceof Error ? error.message : String(error),
        action,
        kind,
        encodedId
      });
      res.send(EMPTY_HLS);
      return;
    }

    // Respond immediately so Stremio's player is not kept waiting while Arr
    // API calls execute. The trigger runs in the background; if Stremio drops
    // the connection before this response arrives, the work still completes.
    res.send(EMPTY_HLS);

    const trigger = action === 'add-search'
      ? statusService.triggerAddAndSearch(parsed)
      : statusService.triggerSearch(parsed);

    trigger.then((result) => {
      if (result.ok) {
        logger.info('Action completed', { action, kind, encodedId, title: result.title });
      } else {
        logger.warn('Action rejected by Arr service', {
          action,
          kind,
          encodedId,
          title: result.title,
          summary: result.summary
        });
      }
    }).catch((error: unknown) => {
      // Log the failure; Stremio has already received the HLS response and
      // will not open an external browser regardless of what happens here.
      logger.error('Action execution failed', {
        error: error instanceof Error ? error.message : String(error),
        action,
        kind,
        encodedId
      });
    });
  });

  app.get('/', (_req, res) => {
    res.type('text/plain').send('stremio-addarr ok\n');
  });

  app.use('/', getRouter(addonInterface));

  return app;
}

const isEntryPoint = import.meta.url === new URL(process.argv[1], 'file:').href;

if (isEntryPoint) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const validation = validateConfig(config);
  for (const issue of validation.issues) {
    logger.warn('Config issue', { issue });
  }
  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    logger.info('Server started', {
      host: config.host,
      port: config.port,
      manifest: `${config.publicBaseUrl}/manifest.json`
    });
  });
}
