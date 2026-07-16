import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import sdk from 'stremio-addon-sdk';
import { loadConfig, validateConfig, type AppConfig } from './config.js';
import { createConfigUiRouter } from './config-ui.js';
import { createLogger } from './logger.js';
import { createAddonInterface } from './addon.js';
import { addonBasePath } from './lib/addon-access.js';
import { verifyActionToken } from './lib/action-tokens.js';
import { parseStremioId } from './lib/stremio-ids.js';
import { verifyFileToken } from './lib/file-tokens.js';
import { SlidingWindowRateLimiter } from './lib/rate-limiter.js';
import type { ParsedStremioId } from './types.js';
import { ActionOrchestrator } from './services/action-orchestrator.js';
import { NoopWatchedLookup } from './services/watched.js';
import { TraktWatchedLookup } from './services/trakt-watched.js';

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

function resolveAssetsDir(): string {
  const candidates = [
    path.resolve(import.meta.dirname, '../assets'),
    path.resolve(import.meta.dirname, '../../assets'),
    path.resolve(process.cwd(), 'assets')
  ];
  for (const candidate of candidates) {
    try {
      const stat = fs.statSync(candidate);
      if (stat.isDirectory()) {
        return candidate;
      }
    } catch {
      // try next candidate
    }
  }
  return candidates[candidates.length - 1];
}

function isPathInsideRoot(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(rootPath, targetPath);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function redactAddonRequestPath(requestPath: string, addonPrefix: string): string {
  return requestPath === addonPrefix || requestPath.startsWith(`${addonPrefix}/`)
    ? `/<protected>${requestPath.slice(addonPrefix.length)}`
    : requestPath;
}

export function createApp(config: AppConfig) {
  const getRouter = (sdk as { getRouter: (addonInterface: unknown) => import('express').RequestHandler }).getRouter;
  const logger = createLogger(config.logLevel);
  const watchedLookup = config.traktSync.enabled
    ? new TraktWatchedLookup(config, logger)
    : new NoopWatchedLookup();
  if (watchedLookup instanceof TraktWatchedLookup) {
    void watchedLookup.init();
  }
  const { addonInterface, statusService } = createAddonInterface(config, logger, { watchedLookup });
  const actionOrchestrator = new ActionOrchestrator(statusService, logger, config.actionQueueMax);
  const addonPrefix = addonBasePath(config);
  const actionRateLimiter = new SlidingWindowRateLimiter(config.actionRateLimitMax, 60_000);

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

  app.use('/assets', express.static(resolveAssetsDir(), {
    immutable: true,
    maxAge: '365d',
    setHeaders(res, filePath) {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      if (filePath.toLowerCase().endsWith('.png')) {
        res.setHeader('Content-Type', 'image/png');
      }
    }
  }));

  app.use((req, res, next) => {
    const reqId = randomUUID();
    res.locals['reqId'] = reqId;
    const start = Date.now();
    res.on('finish', () => {
      logger.info('request', {
        reqId,
        method: req.method,
        path: redactAddonRequestPath(req.path, addonPrefix),
        status: res.statusCode,
        durationMs: Date.now() - start
      });
    });
    next();
  });

  app.use((req, res, next) => {
    const isStremioRoute =
      req.path.startsWith('/assets/') ||
      req.path === `${addonPrefix}/manifest.json` ||
      req.path.startsWith(`${addonPrefix}/stream/`) ||
      req.path.startsWith(`${addonPrefix}/catalog/`) ||
      req.path.startsWith(`${addonPrefix}/status/`) ||
      req.path.startsWith(`${addonPrefix}/action/`) ||
      req.path.startsWith(`${addonPrefix}/files/`);
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

  // Stremio's Configure action opens /configure on the add-on origin. Keep its
  // authenticated API outside the wildcard-CORS Stremio route set.
  if (config.configUiEnabled) {
    app.use(createConfigUiRouter(config, statusService, logger));
  }

  app.get('/health', async (_req, res) => {
    const serviceHealth = await statusService.getServiceHealth();
    res.json({
      ok: true,
      name: config.appName,
      version: config.version,
      manifest: `${config.publicBaseUrl}/<protected>/manifest.json`,
      services: serviceHealth,
      watched: watchedLookup.getDiagnostics?.()
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
      timeZone: config.timeZone,
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
      configIssues,
      watched: watchedLookup.getDiagnostics?.()
    });
  });

  app.post('/trakt/sync', async (req, res) => {
    const remote = req.ip ?? req.socket.remoteAddress ?? '';
    const local = remote === '127.0.0.1' || remote === '::1' || remote.endsWith('127.0.0.1');
    if (!local || !(watchedLookup instanceof TraktWatchedLookup)) {
      res.status(404).end();
      return;
    }
    await watchedLookup.triggerSync();
    res.status(202).json({ ok: true, watched: watchedLookup.getDiagnostics?.() });
  });

  app.get(`${addonPrefix}/status/:kind/:encodedId.m3u8`, (_req, res) => {
    res.type('application/vnd.apple.mpegurl');
    res.setHeader('Cache-Control', 'no-store');
    res.send(EMPTY_HLS);
  });

  app.get(`${addonPrefix}/action/:action/:kind/:encodedId`, (req, res) => {
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

    const expiresAtSec = Number(req.query['exp']);
    const signature = typeof req.query['sig'] === 'string' ? req.query['sig'] : '';
    let decodedId: string;
    try {
      decodedId = decodeURIComponent(encodedId);
    } catch {
      res.status(400).send(EMPTY_HLS);
      return;
    }
    if (!verifyActionToken(config.addonAccessToken, action, kind, decodedId, expiresAtSec, signature)) {
      logger.warn('Action request signature rejected', { reqId, action, kind });
      res.status(403).send(EMPTY_HLS);
      return;
    }
    const clientIp = (req.ips.length > 0 ? req.ips[0] : req.ip) ?? req.socket.remoteAddress ?? 'unknown';
    if (actionRateLimiter.isLimited(clientIp)) {
      res.status(429).send(EMPTY_HLS);
      return;
    }

    let parsed: ParsedStremioId;
    try {
      parsed = parseStremioId(kind, decodedId);
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

    const jobId = actionOrchestrator.enqueue(action, parsed, reqId);
    if (!jobId) {
      res.status(429).send(EMPTY_HLS);
      return;
    }
    // Respond immediately so Stremio's player is never blocked waiting on Arr.
    res.send(EMPTY_HLS);
  });

  app.get(`${addonPrefix}/files/:kind/:fileId`, async (req, res) => {
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
    const expiresAtSec = Number(req.query['exp']);

    if (kind !== 'movie' && kind !== 'series') {
      res.status(400).end();
      return;
    }

    const fileId = Number(fileIdRaw);
    if (!Number.isInteger(fileId) || fileId <= 0) {
      res.status(400).end();
      return;
    }

    if (!verifyFileToken(config.fileStreaming.secret, kind, fileId, expiresAtSec, token)) {
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

    const allowedRootRaw = kind === 'movie' ? config.radarr.rootFolderPath : config.sonarr.rootFolderPath;
    let allowedRootReal: string;
    let resolvedPathReal: string;
    try {
      allowedRootReal = await fsPromises.realpath(allowedRootRaw);
    } catch (error) {
      logger.error('File streaming: allowed root not accessible', {
        reqId,
        kind,
        fileId,
        allowedRoot: allowedRootRaw,
        error: error instanceof Error ? error.message : String(error)
      });
      res.status(500).end();
      return;
    }

    try {
      resolvedPathReal = await fsPromises.realpath(filePath);
    } catch {
      res.status(404).end();
      return;
    }

    if (!isPathInsideRoot(allowedRootReal, resolvedPathReal)) {
      logger.warn('File streaming: path outside allowed root', {
        reqId,
        kind,
        fileId,
        allowedRoot: allowedRootReal,
        resolvedFilePath: resolvedPathReal
      });
      res.status(403).end();
      return;
    }

    res.sendFile(resolvedPathReal, (err) => {
      if (err && !res.headersSent) {
        logger.warn('File streaming: send error', { reqId, kind, fileId, error: err instanceof Error ? err.message : String(err) });
        res.status(404).end();
      }
    });
  });

  app.get('/', (_req, res) => {
    res.type('text/plain').send('stremio-addarr ok\n');
  });

  app.use(addonPrefix, getRouter(addonInterface));

  return app;
}

const isEntryPoint = import.meta.url === new URL(process.argv[1], 'file:').href;

if (isEntryPoint) {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const validation = validateConfig(config);
  logger.info('Effective runtime config', {
    version: config.version,
    host: config.host,
    port: config.port,
    publicBaseUrl: config.publicBaseUrl,
    fileStreamingEnabled: config.fileStreaming.enabled,
    fileStreamingPlaybackMode: config.fileStreaming.playbackMode,
    radarrEnabled: config.radarr.enabled,
    sonarrEnabled: config.sonarr.enabled,
    radarrRootFolderPath: config.radarr.rootFolderPath || null,
    sonarrRootFolderPath: config.sonarr.rootFolderPath || null,
    catalogPageSize: config.catalogPageSize,
    catalogCacheTtlMs: config.catalogCacheTtlMs
  });
  for (const issue of validation.issues) {
    logger.warn('Config issue', { issue });
  }
  const app = createApp(config);
  const server = app.listen(config.port, config.host, () => {
    logger.info('Server started', {
      host: config.host,
      port: config.port,
      manifest: `${config.publicBaseUrl}/<protected>/manifest.json`,
      configure: config.configUiEnabled ? `${config.publicBaseUrl}/configure` : 'disabled'
    });
  });

  let isShuttingDown = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('Shutdown signal received', { signal });
    server.close((error?: Error) => {
      if (error) {
        logger.error('Server shutdown failed', { signal, error: error.message });
        process.exit(1);
        return;
      }
      logger.info('Server shutdown complete', { signal });
      process.exit(0);
    });
    setTimeout(() => {
      logger.warn('Shutdown timeout reached, forcing exit', { signal });
      process.exit(config.forcedShutdownExitCode);
    }, config.gracefulShutdownTimeoutMs).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}
