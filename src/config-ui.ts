import express, { type Request } from 'express';
import type { AppConfig } from './config.js';
import type { Logger } from './logger.js';
import type { ArrStatusService } from './services/status.js';
import { createConfigUiRouter as createConfigUiCoreRouter } from './config-ui-core.js';

interface ConfigUiOptions {
  envFilePath?: string;
  adminToken?: string;
}

function sanitizeCookieHeader(req: Request): void {
  const raw = req.headers.cookie;
  if (!raw) return;
  const safeCookies: string[] = [];
  for (const item of raw.split(';')) {
    const separator = item.indexOf('=');
    if (separator <= 0) continue;
    const key = item.slice(0, separator).trim();
    const value = item.slice(separator + 1).trim();
    if (!key) continue;
    try {
      decodeURIComponent(value);
      safeCookies.push(`${key}=${value}`);
    } catch {
      // Discard malformed user-controlled cookie values rather than allowing
      // decodeURIComponent inside the core router to throw a URIError.
    }
  }
  req.headers.cookie = safeCookies.join('; ');
}

function normalizeBlankTagInputs(req: Request): void {
  if (req.method !== 'PUT' || !req.body || typeof req.body !== 'object' || Array.isArray(req.body)) return;
  const body = req.body as Record<string, unknown>;
  for (const sectionName of ['radarr', 'sonarr'] as const) {
    const section = body[sectionName];
    if (!section || typeof section !== 'object' || Array.isArray(section)) continue;
    const record = section as Record<string, unknown>;
    if (typeof record['tags'] === 'string' && record['tags'].trim() === '') {
      // The core normaliser correctly maps an empty array to an empty env value;
      // this prevents Number('') from being interpreted as tag ID zero.
      record['tags'] = [];
    }
  }
}

function ensureSocketForTestDoubles(req: Request): void {
  const optionalRequest = req as Request & { socket?: { remoteAddress?: string } };
  if (optionalRequest.socket) return;
  Object.defineProperty(optionalRequest, 'socket', {
    configurable: true,
    enumerable: false,
    value: { remoteAddress: undefined }
  });
}

export function createConfigUiRouter(
  config: AppConfig,
  statusService: ArrStatusService,
  logger: Logger,
  options: ConfigUiOptions = {}
) {
  const router = express.Router();

  router.use((req, _res, next) => {
    sanitizeCookieHeader(req);
    ensureSocketForTestDoubles(req);
    next();
  });

  // Parse configuration JSON at the hardened boundary. Express's subsequent
  // JSON middleware sees the already-consumed request and preserves req.body.
  router.use('/api/config', express.json({ limit: '64kb' }), (req, _res, next) => {
    normalizeBlankTagInputs(req);
    next();
  });

  router.use(createConfigUiCoreRouter(config, statusService, logger, options));
  return router;
}
