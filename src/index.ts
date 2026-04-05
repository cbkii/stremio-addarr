import express from 'express';
import sdk from 'stremio-addon-sdk';
import { loadConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { renderActionConfirmPage, renderActionResultPage, renderLandingPage } from './ui/landing.js';

export function createApp(config: AppConfig) {
  const getRouter = (sdk as { getRouter: (addonInterface: unknown) => import('express').RequestHandler }).getRouter;
  const logger = createLogger(config.logLevel);
  const { addonInterface, statusService } = createAddonInterface(config);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));

  app.use((req, res, next) => {
    const start = Date.now();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

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

  app.get('/action/:kind/:encodedId', async (req, res) => {
    const kind = req.params.kind;
    if (kind !== 'movie' && kind !== 'series') {
      res.status(400).send('Unsupported action kind.');
      return;
    }

    try {
      const rawId = decodeURIComponent(req.params.encodedId);
      const parsed = parseStremioId(kind, rawId);
      if (config.actionConfirm) {
        res.type('html').send(renderActionConfirmPage(parsed, req.path));
        return;
      }
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
              detail: 'Please verify Arr connectivity and try again.'
            },
            '/'
          )
        );
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
            '/'
          )
        );
    }
  });

  app.get('/', async (_req, res) => {
    const health = await statusService.getServiceHealth();
    res.type('html').send(renderLandingPage(config, health));
  });

  app.use('/', getRouter(addonInterface));

  return app;
}

const isEntryPoint = import.meta.url === new URL(process.argv[1], 'file:').href;

if (isEntryPoint) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const app = createApp(config);
  app.listen(config.port, config.host, () => {
    logger.info('Server started', {
      host: config.host,
      port: config.port,
      manifest: `${config.publicBaseUrl}/manifest.json`
    });
  });
}
