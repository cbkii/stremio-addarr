import express from 'express';
import sdk from 'stremio-addon-sdk';
import { loadConfig, validateConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { renderActionConfirmPage, renderActionResultPage } from './ui/landing.js';

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
  app.use(express.urlencoded({ extended: false }));

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

  // CORS only for Stremio SDK JSON routes (manifest + stream), not action endpoints
  app.use((req, res, next) => {
    const isStremioRoute = req.path === '/manifest.json' || req.path.startsWith('/stream/');
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
      actionConfirm: config.actionConfirm,
      services: serviceHealth
    });
  });

  app.get('/healthz', (_req, res) => {
    res.json({ ok: true });
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
      publicBaseUrl: config.publicBaseUrl,
      publicBaseUrlIsHttps: validation.isHttps,
      actionConfirm: config.actionConfirm,
      statusCacheTtlMs: config.statusCacheTtlMs,
      requestTimeoutMs: config.requestTimeoutMs,
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

  app.get('/action/:kind/:encodedId', async (req, res) => {
    const kind = req.params.kind;
    if (kind !== 'movie' && kind !== 'series') {
      res.status(400).send('Unsupported action kind.');
      return;
    }

    try {
      const rawId = decodeURIComponent(req.params.encodedId);
      const parsed = parseStremioId(kind, rawId);

      if (!config.actionConfirm) {
        // Default: perform the add directly on GET — the user already clicked in Stremio.
        const result = await statusService.triggerAdd(parsed);
        const returnLink = statusService.buildReturnLink(parsed);
        res.type('html').send(renderActionResultPage(result, returnLink));
      } else {
        // Explicit confirmation requested: show a minimal confirm form.
        const actionPath = `/action/${kind}/${encodeURIComponent(parsed.rawId)}`;
        res.type('html').send(renderActionConfirmPage(parsed, actionPath));
      }
    } catch (error) {
      logger.error('Action request failed', {
        error: error instanceof Error ? error.message : String(error),
        kind,
        encodedId: req.params.encodedId
      });
      res.status(400).send('Invalid action request.');
    }
  });

  app.post('/action/:kind/:encodedId', async (req, res) => {
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
      logger.error('Action execution failed', {
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
              summary: 'Could not complete add request.',
              detail: 'Try again after checking Arr settings.'
            },
            'stremio://'
          )
        );
    }
  });

  app.get('/', (_req, res) => {
    res.json({
      ok: true,
      name: config.appName,
      version: config.version,
      manifest: `${config.publicBaseUrl}/manifest.json`
    });
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
