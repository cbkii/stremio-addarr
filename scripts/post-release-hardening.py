from pathlib import Path

# Protocol-valid status fallback for the remaining Sonarr health branch.
p = Path('src/services/status.ts')
s = p.read_text()
old = "return [{ name: '🛑❌\\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()) }];"
new = "return [{ name: '🛑❌\\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()), url: this.buildStatusStreamUrl(parsed), behaviorHints: { notWebReady: true } }];"
assert s.count(old) == 1, s.count(old)
p.write_text(s.replace(old, new))

# Shared protected URL/signature helpers for integration tests.
p = Path('test/_helpers.ts')
s = p.read_text()
s = s.replace("import { buildDefaultManifestLogoUrl } from '../src/config.js';", "import { buildDefaultManifestLogoUrl } from '../src/config.js';\nimport { addonBasePath } from '../src/lib/addon-access.js';\nimport { buildActionToken } from '../src/lib/action-tokens.js';\nimport { buildFileToken } from '../src/lib/file-tokens.js';")
insert = '''\nexport function addonUrl(baseUrl: string, config: AppConfig = baseConfig()): string {\n  return `${baseUrl}${addonBasePath(config)}`;\n}\n\nexport function signedActionUrl(\n  baseUrl: string,\n  config: AppConfig,\n  action: 'search' | 'add-search',\n  kind: 'movie' | 'series',\n  rawId: string,\n  expiresAtSec = Math.floor(Date.now() / 1000) + config.actionTokenTtlSec\n): string {\n  const signature = buildActionToken(config.addonAccessToken, action, kind, rawId, expiresAtSec);\n  return `${addonUrl(baseUrl, config)}/action/${action}/${kind}/${encodeURIComponent(rawId)}?exp=${expiresAtSec}&sig=${encodeURIComponent(signature)}`;\n}\n\nexport function signedFileUrl(\n  baseUrl: string,\n  config: AppConfig,\n  kind: 'movie' | 'series',\n  fileId: number,\n  options: { secret?: string; tokenFileId?: number; token?: string; expiresAtSec?: number } = {}\n): string {\n  const expiresAtSec = options.expiresAtSec ?? Math.floor(Date.now() / 1000) + config.fileStreaming.tokenTtlSec;\n  const token = options.token ?? buildFileToken(\n    options.secret ?? config.fileStreaming.secret,\n    kind,\n    options.tokenFileId ?? fileId,\n    expiresAtSec\n  );\n  return `${addonUrl(baseUrl, config)}/files/${kind}/${fileId}?exp=${expiresAtSec}&t=${encodeURIComponent(token)}`;\n}\n'''
pos = s.index('\nexport async function withServer')
s = s[:pos] + insert + s[pos:]
p.write_text(s)

# Add-on protocol tests use the opaque install path and signed URLs.
p = Path('test/addon.test.ts')
s = p.read_text()
s = s.replace("import { baseConfig, withServer } from './_helpers.js';", "import { addonUrl, baseConfig, withServer } from './_helpers.js';")
s = s.replace("test('manifest endpoint shape sanity', async () => {\n  const app = createApp(baseConfig());", "test('manifest endpoint shape sanity', async () => {\n  const cfg = baseConfig();\n  const app = createApp(cfg);")
s = s.replace("test('catalog handler returns empty metas when endpoint type does not match catalog type', async () => {\n  const app = createApp(baseConfig());", "test('catalog handler returns empty metas when endpoint type does not match catalog type', async () => {\n  const cfg = baseConfig();\n  const app = createApp(cfg);")
s = s.replace("test('catalog route includes CORS headers', async () => {\n  const app = createApp(baseConfig());", "test('catalog route includes CORS headers', async () => {\n  const cfg = baseConfig();\n  const app = createApp(cfg);")
for resource in ('manifest', 'catalog', 'stream'):
    s = s.replace(f'`${{baseUrl}}/{resource}', f'`${{addonUrl(baseUrl, cfg)}}/{resource}')
s = s.replace("assert.equal(body.streams[0].url, 'https://stremio-addarr.lan/action/search/movie/tt1234567');", """const actionUrl = new URL(body.streams[0].url ?? '');
    assert.equal(actionUrl.origin, 'https://stremio-addarr.lan');
    assert.equal(actionUrl.pathname, `/${encodeURIComponent(cfg.addonAccessToken)}/action/search/movie/tt1234567`);
    assert.ok(Number.isSafeInteger(Number(actionUrl.searchParams.get('exp'))));
    assert.ok(actionUrl.searchParams.get('sig'));""")
s = s.replace("assert.equal(body.streams[0].url, 'https://stremio-addarr.lan/action/search/series/tt7654321%3A2%3A5');", """const actionUrl = new URL(body.streams[0].url ?? '');
    assert.equal(actionUrl.origin, 'https://stremio-addarr.lan');
    assert.equal(actionUrl.pathname, `/${encodeURIComponent(cfg.addonAccessToken)}/action/search/series/tt7654321%3A2%3A5`);
    assert.ok(actionUrl.searchParams.get('exp'));
    assert.ok(actionUrl.searchParams.get('sig'));""")
s = s.replace("assert.ok(body.streams[0].url?.startsWith('https://pi.example.com/files/movie/77?t='), 'should have a file streaming url');", """const fileUrl = new URL(body.streams[0].url ?? '');
    assert.equal(fileUrl.pathname, `/${encodeURIComponent(cfg.addonAccessToken)}/files/movie/77`);
    assert.ok(fileUrl.searchParams.get('exp'));
    assert.ok(fileUrl.searchParams.get('t'), 'should have a signed file streaming url');""")
s = s.replace("assert.ok(body.streams[0].url?.startsWith('https://pi.example.com/files/series/88?t='), 'should have episode file streaming url');", """const fileUrl = new URL(body.streams[0].url ?? '');
    assert.equal(fileUrl.pathname, `/${encodeURIComponent(cfg.addonAccessToken)}/files/series/88`);
    assert.ok(fileUrl.searchParams.get('exp'));
    assert.ok(fileUrl.searchParams.get('t'), 'should have a signed episode file streaming url');""")
s = s.replace("assert.equal(body.streams[0].url, undefined, 'no url when file streaming disabled');", "assert.match(body.streams[0].url ?? '', /\\/status\\/movie\\/tt1234567\\.m3u8$/, 'status fallback keeps the stream object protocol-valid');")
p.write_text(s)

# Mutation route tests use valid short-lived signatures.
p = Path('test/app-routes.test.ts')
s = p.read_text()
s = s.replace("import { baseConfig, withServer } from './_helpers.js';", "import { baseConfig, signedActionUrl, withServer } from './_helpers.js';")
s = s.replace("`${baseUrl}/action/search/movie/tt1234567`", "signedActionUrl(baseUrl, cfg, 'search', 'movie', 'tt1234567')")
s = s.replace("    const encoded = encodeURIComponent('tt7654321:2:5');\n", '')
s = s.replace("`${baseUrl}/action/add-search/series/${encoded}`", "signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt7654321:2:5')")
s = s.replace("`${baseUrl}/action/add-search/series/tt1111111`", "signedActionUrl(baseUrl, cfg, 'add-search', 'series', 'tt1111111')")
p.write_text(s)

# File route tests exercise protected paths and expiring HMACs.
p = Path('test/file-streaming.test.ts')
s = p.read_text()
s = s.replace("import { baseConfig, withServer } from './_helpers.js';", "import { addonUrl, baseConfig, signedFileUrl, withServer } from './_helpers.js';")
s = s.replace("`${baseUrl}/files/movie/42?t=sometoken`", "`${addonUrl(baseUrl, cfg)}/files/movie/42?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`")
s = s.replace("`${baseUrl}/files/unknown/42?t=${token}`", "`${addonUrl(baseUrl, cfg)}/files/unknown/42?exp=${Math.floor(Date.now() / 1000) + 3600}&t=${token}`")
s = s.replace("`${baseUrl}/files/movie/abc?t=sometoken`", "`${addonUrl(baseUrl, cfg)}/files/movie/abc?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`")
s = s.replace("`${baseUrl}/files/movie/0?t=sometoken`", "`${addonUrl(baseUrl, cfg)}/files/movie/0?exp=${Math.floor(Date.now() / 1000) + 3600}&t=sometoken`")
s = s.replace("`${baseUrl}/files/movie/42`", "`${addonUrl(baseUrl, cfg)}/files/movie/42?exp=${Math.floor(Date.now() / 1000) + 3600}`")
s = s.replace("`${baseUrl}/files/movie/42?t=${wrongToken}`", "signedFileUrl(baseUrl, cfg, 'movie', 42, { token: wrongToken })")
s = s.replace("`${baseUrl}/files/movie/42?t=${tokenFor99}`", "signedFileUrl(baseUrl, cfg, 'movie', 42, { tokenFileId: 99 })")
for kind, fid in [('movie',42),('movie',99),('movie',7),('movie',88),('movie',89),('series',55),('movie',1),('movie',3),('movie',5)]:
    s = s.replace(f"`${{baseUrl}}/files/{kind}/{fid}?t=${{token}}`", f"signedFileUrl(baseUrl, cfg, '{kind}', {fid})")
p.write_text(s)

# Admin UI tests explicitly opt in; manifest remains under the protected route.
for filename in ('test/config-ui.test.ts', 'test/config-ui-hardening.test.ts'):
    p = Path(filename)
    s = p.read_text()
    if filename == 'test/config-ui.test.ts':
        s = s.replace("import { baseConfig, withServer } from './_helpers.js';", "import { addonUrl, baseConfig, withServer } from './_helpers.js';")
    marker = 'const tempDirs: string[] = [];'
    helper = """const tempDirs: string[] = [];

function uiConfig() {
  const cfg = baseConfig();
  cfg.configUiEnabled = true;
  return cfg;
}"""
    s = s.replace(marker, helper)
    s = s.replace('createApp(baseConfig())', 'createApp(uiConfig())')
    s = s.replace('  const cfg = baseConfig();\n  const app = createApp(cfg);', '  const cfg = uiConfig();\n  const app = createApp(cfg);')
    p.write_text(s)
p = Path('test/config-ui.test.ts')
s = p.read_text()
s = s.replace("test('manifest advertises Stremio configuration without making it mandatory', async () => {\n  const app = createApp(uiConfig());", "test('manifest advertises Stremio configuration without making it mandatory', async () => {\n  const cfg = uiConfig();\n  const app = createApp(cfg);")
s = s.replace('`${baseUrl}/manifest.json`', '`${addonUrl(baseUrl, cfg)}/manifest.json`')
s = s.replace('  const cfg = baseConfig();\n  const seenKeys', '  const cfg = uiConfig();\n  const seenKeys')
p.write_text(s)
