import express from 'express';
import { getRouter } from 'stremio-addon-sdk';
import { loadConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { renderActionResultPage, renderLandingPage } from './ui/landing.js';

const config = loadConfig();
const logger = createLogger(config.logLevel);
const { addonInterface, statusService } = createAddonInterface(config);

const app = express();
app.disable('x-powered-by');

app.get('/health', async (_req, res) => {
  res.json({
    ok: true,
    name: 'stremio-addarr',
    manifest: `${config.publicBaseUrl}/manifest.json`,
    radarrEnabled: config.radarr.enabled,
    sonarrEnabled: config.sonarr.enabled,
    actionConfirm: config.actionConfirm
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
