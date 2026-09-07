from pathlib import Path

path = Path('test/file-streaming.test.ts')
text = path.read_text()
old = """// ── Rate limiting ─────────────────────────────────────────────────────────────

test('file route returns 429 after exceeding rate limit', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath.startsWith('/api/v3/moviefile/')) return new Response('{}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 5);

  await withServer(app, async (baseUrl) => {
    // Send 121 requests — the 121st should be rate-limited (limit is 120/min).
    let lastStatus = 0;
    for (let i = 0; i <= 120; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429, 'should return 429 after limit is exceeded');
  });
});

test('file route rate limiting is keyed by forwarded client IP behind trusted loopback proxy', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const urlPath = new URL(String(input)).pathname;
    if (urlPath.startsWith('/api/v3/moviefile/')) return new Response('{}', { status: 200 });
    return new Response('[]', { status: 200 });
  }) as typeof fetch;

  const app = createApp(cfg);
  const token = buildFileToken(FILE_SECRET, 'movie', 5);

  await withServer(app, async (baseUrl) => {
    let statusIp1 = 0;
    for (let i = 0; i <= 120; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5), {
        headers: { 'X-Forwarded-For': '203.0.113.1' }
      });
      statusIp1 = res.status;
    }
    assert.equal(statusIp1, 429, 'first forwarded client should be rate limited');

    const resIp2 = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5), {
      headers: { 'X-Forwarded-For': '203.0.113.2' }
    });
    assert.notEqual(resIp2.status, 429, 'different forwarded client should not share same limiter bucket');
  });
});"""
new = """// ── Invalid-token abuse limiting ──────────────────────────────────────────────

test('invalid file tokens are rate limited after repeated rejected attempts', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  const app = createApp(cfg);
  const validToken = buildFileToken(FILE_SECRET, 'movie', 5);
  const invalidToken = validToken.replace(/.$/, validToken.endsWith('0') ? '1' : '0');

  await withServer(app, async (baseUrl) => {
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5, { token: invalidToken }));
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429, 'invalid attempts should become rate limited after the 30/min bucket');
  });
});

test('invalid-token limiter is keyed by forwarded client IP behind trusted loopback proxy', async () => {
  const cfg = baseConfig();
  cfg.fileStreaming.enabled = true;
  cfg.fileStreaming.secret = FILE_SECRET;
  cfg.radarr.enabled = true;

  const app = createApp(cfg);
  const validToken = buildFileToken(FILE_SECRET, 'movie', 5);
  const invalidToken = validToken.replace(/.$/, validToken.endsWith('0') ? '1' : '0');

  await withServer(app, async (baseUrl) => {
    let statusIp1 = 0;
    for (let i = 0; i < 31; i++) {
      const res = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5, { token: invalidToken }), {
        headers: { 'X-Forwarded-For': '203.0.113.1' }
      });
      statusIp1 = res.status;
    }
    assert.equal(statusIp1, 429, 'first forwarded client should exhaust only its invalid-token bucket');

    const resIp2 = await ORIGINAL_FETCH(signedFileUrl(baseUrl, cfg, 'movie', 5, { token: invalidToken }), {
      headers: { 'X-Forwarded-For': '203.0.113.2' }
    });
    assert.equal(resIp2.status, 403, 'different forwarded client should start with a fresh invalid-token bucket');
  });
});"""
count = text.count(old)
if count != 1:
    raise SystemExit(f'expected stale rate-test block once, found {count}')
path.write_text(text.replace(old, new))
