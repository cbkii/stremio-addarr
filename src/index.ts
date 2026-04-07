import { randomUUID } from 'node:crypto';
import path from 'node:path';
import express from 'express';
import sdk from 'stremio-addon-sdk';
import { loadConfig, validateConfig, type AppConfig } from './config.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { verifyFileToken } from './lib/file-tokens.js';
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
  const { addonInterface, statusService } = createAddonInterface(config, logger);

  // Simple in-memory token-bucket rate limiter for the /files route.
  // Limits each IP to at most 120 file requests per minute to deter brute-force
  // token guessing while allowing normal buffered video playback.
  const fileRateMap = new Map<string, { count: number; resetAt: number }>();
  const FILE_RATE_MAX = 120;
  const FILE_RATE_WINDOW_MS = 60_000;

  function isFilesRateLimited(ip: string): boolean {
    const now = Date.now();
    // Evict expired entries on each check to prevent unbounded memory growth from unique IPs.
    for (const [key, entry] of fileRateMap) {
      if (now >= entry.resetAt) fileRateMap.delete(key);
    }
    const entry = fileRateMap.get(ip);
    if (!entry || now >= entry.resetAt) {
      fileRateMap.set(ip, { count: 1, resetAt: now + FILE_RATE_WINDOW_MS });
      return false;
    }
    entry.count++;
    return entry.count > FILE_RATE_MAX;
  }

  const app = express();
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use((req, res, next) => {
    const reqId = randomUUID();
    res.locals['reqId'] = reqId;
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        reqId,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        durationMs: Date.now() - start
      });
    });
    next();
  });

  app.use((req, res, next) => {
    const isStremioRoute =
      req.path === '/manifest.json' ||
      req.path.startsWith('/stream/') ||
      req.path.startsWith('/catalog/') ||
      req.path.startsWith('/action/') ||
      req.path.startsWith('/files/');
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
      catalogPageSize: config.catalogPageSize,
      catalogCacheTtlMs: config.catalogCacheTtlMs,
      catalogCacheMaxAgeSec: config.catalogCacheMaxAgeSec,
      catalogStaleRevalidateSec: config.catalogStaleRevalidateSec,
      catalogStaleErrorSec: config.catalogStaleErrorSec,
      tmdbNegativeCacheTtlMs: config.tmdbNegativeCacheTtlMs,
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
    // Capture the correlation ID set by the request-logging middleware above so
    // it can be included in background log entries emitted after the response.
    const reqId = typeof res.locals['reqId'] === 'string' ? res.locals['reqId'] : undefined;

    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');

    if (kind !== 'movie' && kind !== 'series') {
      logger.error('Action request with unsupported kind', { reqId, kind, action });
      res.send(EMPTY_HLS);
      return;
    }
    if (action !== 'search' && action !== 'add-search') {
      logger.error('Action request with unsupported action', { reqId, kind, action });
      res.send(EMPTY_HLS);
      return;
    }

    let parsed: ParsedStremioId;
    try {
      parsed = parseStremioId(kind, decodeURIComponent(encodedId));
    } catch (error) {
      logger.error('Action id parse error', {
        reqId,
        error: error instanceof Error ? error.message : String(error),
        action,
        kind,
        encodedId
      });
      res.send(EMPTY_HLS);
      return;
    }

    // Respond immediately so Stremio's player is never blocked waiting on Arr
    // API calls. The trigger runs fire-and-forget; even if Stremio drops the
    // connection, the add/search operations still complete on the server.
    res.send(EMPTY_HLS);

    const trigger = action === 'add-search'
      ? statusService.triggerAddAndSearch(parsed)
      : statusService.triggerSearch(parsed);

    trigger.then((result) => {
      if (result.ok) {
        logger.info('Action completed', { reqId, background: true, action, kind, encodedId, title: result.title });
      } else {
        logger.warn('Action rejected by Arr service', {
          reqId,
          background: true,
          action,
          kind,
          encodedId,
          title: result.title,
          summary: result.summary
        });
      }
    }).catch((error: unknown) => {
      // Log the failure; Stremio has already received the HLS response and will
      // not open an external browser regardless of what happens here.
      logger.error('Action execution failed', {
        reqId,
        background: true,
        error: error instanceof Error ? error.message : String(error),
        action,
        kind,
        encodedId
      });
    });
  });

  app.get('/files/:kind/:fileId', async (req, res) => {
    const reqId = typeof res.locals['reqId'] === 'string' ? res.locals['reqId'] : undefined;

    if (!config.fileStreaming.enabled) {
      res.status(404).end();
      return;
    }

    const clientIp = (req.ips.length > 0 ? req.ips[0] : req.ip) ?? req.socket.remoteAddress ?? 'unknown';
    if (isFilesRateLimited(clientIp)) {
      res.status(429).end();
      return;
    }

    const { kind, fileId: fileIdRaw } = req.params;
    const token = typeof req.query['t'] === 'string' ? req.query['t'] : '';

    if (kind !== 'movie' && kind !== 'series') {
      res.status(400).end();
      return;
    }

    const fileId = Number(fileIdRaw);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).end();
      return;
    }

    if (!verifyFileToken(config.fileStreaming.secret, kind, fileId, token)) {
      logger.warn('File streaming: invalid token', { reqId, kind, fileId });
      res.status(403).end();
      return;
    }

    let filePath: string | null = null;
    try {
      filePath = kind === 'movie'
        ? await statusService.getMovieFilePath(fileId)
        : await statusService.getEpisodeFilePath(fileId);
    } catch (error) {
      logger.warn('File streaming: path lookup failed', { reqId, kind, fileId, error: error instanceof Error ? error.message : String(error) });
    }

    if (!filePath) {
      res.status(404).end();
      return;
    }

    const allowedRootRaw = kind === 'movie'
      ? config.radarr.rootFolderPath
      : config.sonarr.rootFolderPath;
    const allowedRoot = path.resolve(allowedRootRaw);
    const resolvedPath = path.resolve(filePath);

    if (!resolvedPath.startsWith(allowedRoot + path.sep)) {
      logger.warn('File streaming: path outside allowed root', { reqId, kind, fileId });
      res.status(403).end();
      return;
    }

    res.sendFile(resolvedPath, (err) => {
      if (err && !res.headersSent) {
        logger.warn('File streaming: send error', { reqId, kind, fileId, error: err instanceof Error ? err.message : String(err) });
        res.status(404).end();
      }
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
