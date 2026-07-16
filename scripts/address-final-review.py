from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:120]}')
    p.write_text(text.replace(old, new, 1))

# Preserve a configured Sonarr v3 language profile when the optional discovery call fails.
replace_once(
    'assets/configure.js',
    """      option(language, 0, 'Not used');
      for (const item of options.languageProfiles) option(language, item.id, item.name);
      language.value = selectedLanguage || '0';""",
    """      option(language, 0, 'Not used');
      for (const item of options.languageProfiles) option(language, item.id, item.name);
      if (selectedLanguage && ![...language.options].some((item) => item.value === selectedLanguage)) {
        option(language, selectedLanguage, `Profile ${selectedLanguage}`);
      }
      language.value = selectedLanguage || '0';"""
)

# Probe credentials may only be reused for the origin they were configured for.
replace_once(
    'src/config-ui-core.ts',
    """function arrProbeInput(body: unknown, service: 'radarr' | 'sonarr', config: AppConfig, pending: Map<string, string>): ArrProbeInput {
  const record = readRecord(body, `${service} probe`);
  const isRadarr = service === 'radarr';
  const prefix = isRadarr ? 'RADARR' : 'SONARR';
  const current = isRadarr ? config.radarr : config.sonarr;
  const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? pending.get(`${prefix}_BASE_URL`) ?? current.baseUrl, `${service} server URL`);
  const suppliedKey = readStringField(record, 'apiKey');
  const apiKey = suppliedKey || pending.get(`${prefix}_API_KEY`) || current.apiKey;
  if (!apiKey) throw new Error(`${service} API key is required.`);
  return { baseUrl, apiKey };
}""",
    """export function credentialForProbeOrigin(
  requestedBaseUrl: string,
  suppliedCredential: string,
  storedBaseUrl: string,
  storedCredential: string
): string {
  if (suppliedCredential) return suppliedCredential;
  try {
    return new URL(requestedBaseUrl).origin === new URL(storedBaseUrl).origin ? storedCredential : '';
  } catch {
    return '';
  }
}

function arrProbeInput(body: unknown, service: 'radarr' | 'sonarr', config: AppConfig, pending: Map<string, string>): ArrProbeInput {
  const record = readRecord(body, `${service} probe`);
  const isRadarr = service === 'radarr';
  const prefix = isRadarr ? 'RADARR' : 'SONARR';
  const current = isRadarr ? config.radarr : config.sonarr;
  const storedBaseUrl = pending.get(`${prefix}_BASE_URL`) || current.baseUrl;
  const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? storedBaseUrl, `${service} server URL`);
  const suppliedKey = readStringField(record, 'apiKey');
  const storedKey = pending.get(`${prefix}_API_KEY`) || current.apiKey;
  const apiKey = credentialForProbeOrigin(baseUrl, suppliedKey, storedBaseUrl, storedKey);
  if (!apiKey) throw new Error(`${service} API key must be supplied when testing a different server origin.`);
  return { baseUrl, apiKey };
}"""
)

replace_once(
    'src/config-ui-core.ts',
    """        const record = readRecord(req.body, 'TMDB probe');
        const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? values.get('TMDB_API_BASE_URL') ?? config.tmdb.apiBaseUrl, 'TMDB API URL');
        const token = readStringField(record, 'authToken') || values.get('TMDB_API_READ_ACCESS_TOKEN') || config.tmdb.authToken;
        if (!token) throw new Error('TMDB token is required.');""",
    """        const record = readRecord(req.body, 'TMDB probe');
        const storedBaseUrl = values.get('TMDB_API_BASE_URL') || config.tmdb.apiBaseUrl;
        const baseUrl = normalizeHttpUrl(record['baseUrl'] ?? storedBaseUrl, 'TMDB API URL');
        const suppliedToken = readStringField(record, 'authToken');
        const storedToken = values.get('TMDB_API_READ_ACCESS_TOKEN') || config.tmdb.authToken;
        const token = credentialForProbeOrigin(baseUrl, suppliedToken, storedBaseUrl, storedToken);
        if (!token) throw new Error('TMDB token must be supplied when testing a different server origin.');"""
)

# Bound authenticated control traffic and serialised environment writes.
replace_once(
    'src/config-ui-core.ts',
    """const LOGIN_MAX_ATTEMPTS = 8;
const JSON_LIMIT = '64kb';""",
    """const LOGIN_MAX_ATTEMPTS = 8;
const CONTROL_WINDOW_MS = 60_000;
const CONTROL_MAX_REQUESTS = 60;
const WRITE_QUEUE_MAX = 4;
const JSON_LIMIT = '64kb';"""
)
replace_once(
    'src/config-ui-core.ts',
    """interface Session {
  csrf: string;
  expiresAt: number;
}""",
    """interface Session {
  csrf: string;
  expiresAt: number;
  controlCount: number;
  controlResetAt: number;
}"""
)
replace_once(
    'src/config-ui-core.ts',
    """interface ConfigUiOptions {
  envFilePath?: string;
  adminToken?: string;
}""",
    """interface ConfigUiOptions {
  envFilePath?: string;
  adminToken?: string;
  controlRateLimitMax?: number;
  writeQueueMax?: number;
}"""
)
replace_once(
    'src/config-ui-core.ts',
    """  const adminToken = (options.adminToken ?? process.env['CONFIG_UI_TOKEN'] ?? '').trim();
  const authEnabled = config.configUiEnabled && adminToken.length >= 16;
  const secureCookie = new URL(config.publicBaseUrl).protocol === 'https:';""",
    """  const adminToken = (options.adminToken ?? process.env['CONFIG_UI_TOKEN'] ?? '').trim();
  if (config.configUiEnabled && adminToken.length < 16) {
    throw new Error('CONFIG_UI_TOKEN must be at least 16 characters when CONFIG_UI_ENABLED=true.');
  }
  const authEnabled = config.configUiEnabled;
  const controlRateLimitMax = options.controlRateLimitMax ?? CONTROL_MAX_REQUESTS;
  const writeQueueMax = options.writeQueueMax ?? WRITE_QUEUE_MAX;
  const secureCookie = new URL(config.publicBaseUrl).protocol === 'https:';"""
)
replace_once(
    'src/config-ui-core.ts',
    """  const loginWindows = new Map<string, LoginWindow>();
  let writeQueue: Promise<void> = Promise.resolve();""",
    """  const loginWindows = new Map<string, LoginWindow>();
  let writeQueue: Promise<void> = Promise.resolve();
  let pendingWrites = 0;"""
)
replace_once(
    'src/config-ui-core.ts',
    """  async function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    const result = writeQueue.then(task, task);
    writeQueue = result.then(() => undefined, () => undefined);
    return result;
  }""",
    """  function requireControlRate(req: Request, res: Response, next: NextFunction): void {
    const session = res.locals['configUiSession'] as Session | undefined;
    const now = Date.now();
    if (!session) {
      res.status(401).json({ error: 'authentication_required' });
      return;
    }
    if (session.controlResetAt <= now) {
      session.controlCount = 0;
      session.controlResetAt = now + CONTROL_WINDOW_MS;
    }
    session.controlCount += 1;
    if (session.controlCount > controlRateLimitMax) {
      res.status(429).json({ error: 'control_rate_limit_exceeded' });
      return;
    }
    next();
  }

  function enqueueWrite<T>(task: () => Promise<T>): Promise<T> {
    if (pendingWrites >= writeQueueMax) {
      return Promise.reject(Object.assign(new Error('Configuration write queue is full.'), { code: 'CONFIG_WRITE_QUEUE_FULL' }));
    }
    pendingWrites += 1;
    const result = writeQueue.then(task, task);
    writeQueue = result.then(() => undefined, () => undefined);
    return result.finally(() => { pendingWrites -= 1; });
  }"""
)
replace_once(
    'src/config-ui-core.ts',
    """    const session: Session = { csrf: randomBytes(24).toString('base64url'), expiresAt: now + SESSION_TTL_MS };""",
    """    const session: Session = {
      csrf: randomBytes(24).toString('base64url'),
      expiresAt: now + SESSION_TTL_MS,
      controlCount: 0,
      controlResetAt: now + CONTROL_WINDOW_MS
    };"""
)
replace_once(
    'src/config-ui-core.ts',
    """  router.put('/api/config', sameOrigin, requireSession, requireCsrf, async (req, res) => {""",
    """  router.put('/api/config', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {"""
)
replace_once(
    'src/config-ui-core.ts',
    """    } catch (error) {
      logger.warn('Configuration UI save rejected', { error: error instanceof Error ? error.message : String(error) });
      res.status(400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/config/test/:service', sameOrigin, requireSession, requireCsrf, async (req, res) => {""",
    """    } catch (error) {
      logger.warn('Configuration UI save rejected', { error: error instanceof Error ? error.message : String(error) });
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      res.status(code === 'CONFIG_WRITE_QUEUE_FULL' ? 429 : 400).json({ error: error instanceof Error ? error.message : String(error) });
    }
  });

  router.post('/api/config/test/:service', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {"""
)
replace_once(
    'src/config-ui-core.ts',
    """  router.post('/api/config/options/:service', sameOrigin, requireSession, requireCsrf, async (req, res) => {""",
    """  router.post('/api/config/options/:service', sameOrigin, requireSession, requireCsrf, requireControlRate, async (req, res) => {"""
)

# Tests for origin binding, fail-fast token validation and control limiting.
p = Path('test/config-ui-hardening.test.ts')
text = p.read_text()
text = text.replace(
    "import { createApp } from '../src/index.js';",
    "import express from 'express';\nimport { createApp } from '../src/index.js';\nimport { createConfigUiRouter, credentialForProbeOrigin } from '../src/config-ui-core.js';\nimport { createLogger } from '../src/logger.js';"
)
text += """

test('probe credentials are reused only for the configured origin', () => {
  assert.equal(
    credentialForProbeOrigin('http://radarr.local/api', '', 'http://radarr.local', 'stored-secret'),
    'stored-secret'
  );
  assert.equal(
    credentialForProbeOrigin('http://other.local', '', 'http://radarr.local', 'stored-secret'),
    ''
  );
  assert.equal(
    credentialForProbeOrigin('http://other.local', 'fresh-secret', 'http://radarr.local', 'stored-secret'),
    'fresh-secret'
  );
});

test('enabled configuration UI rejects a short administrator token at startup', () => {
  process.env['CONFIG_UI_TOKEN'] = 'too-short';
  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be at least 16 characters/);
});

test('authenticated control routes are rate limited per session', async () => {
  const cfg = uiConfig();
  const token = 'correct-horse-battery-staple';
  const envFile = await tempEnv();
  const app = express();
  const statusService = {
    getServiceHealth: async () => ({
      radarr: { configured: false, reachable: false, detail: 'disabled' },
      sonarr: { configured: false, reachable: false, detail: 'disabled' }
    })
  };
  app.use(createConfigUiRouter(cfg, statusService as never, createLogger('none'), {
    adminToken: token,
    envFilePath: envFile,
    controlRateLimitMax: 1
  }));

  await withServer(app, async (baseUrl) => {
    const session = await login(baseUrl, token);
    const headers = {
      cookie: session.cookie,
      'content-type': 'application/json',
      'x-csrf-token': session.csrf
    };
    const first = await fetch(`${baseUrl}/api/config/test/unsupported`, {
      method: 'POST', headers, body: '{}'
    });
    assert.equal(first.status, 404);
    const second = await fetch(`${baseUrl}/api/config/test/unsupported`, {
      method: 'POST', headers, body: '{}'
    });
    assert.equal(second.status, 429);
    assert.deepEqual(await second.json(), { error: 'control_rate_limit_exceeded' });
  });
});
"""
p.write_text(text)
