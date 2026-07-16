from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: expected one match, found {count}: {old[:100]}')
    file.write_text(text.replace(old, new, 1))

# Never place the opaque install credential in request logs.
replace_once(
    'src/index.ts',
    "export function createApp(config: AppConfig) {",
    """export function redactAddonRequestPath(requestPath: string, addonPrefix: string): string {
  return requestPath === addonPrefix || requestPath.startsWith(`${addonPrefix}/`)
    ? `/<protected>${requestPath.slice(addonPrefix.length)}`
    : requestPath;
}

export function createApp(config: AppConfig) {"""
)
replace_once('src/index.ts', '        path: req.path,', '        path: redactAddonRequestPath(req.path, addonPrefix),')

replace_once(
    'test/release-hardening.test.ts',
    "import { createApp } from '../src/index.js';",
    "import { createApp, redactAddonRequestPath } from '../src/index.js';"
)
replace_once(
    'test/release-hardening.test.ts',
    "test('stream adapter rejects protocol-invalid source-less streams', () => {",
    """test('request logging redacts the opaque add-on path token', () => {
  assert.equal(
    redactAddonRequestPath('/secret-install-token/stream/movie/tt123.json', '/secret-install-token'),
    '/<protected>/stream/movie/tt123.json'
  );
  assert.equal(redactAddonRequestPath('/healthz', '/secret-install-token'), '/healthz');
});

test('stream adapter rejects protocol-invalid source-less streams', () => {"""
)

# Bring all operator examples in line with the v1.6 protocol/security contract.
readme = Path('README.md')
text = readme.read_text()
text = text.replace('PUBLIC_BASE_URL=https://YOUR_HOSTNAME\nTARGET_CLIENT=android-tv', 'PUBLIC_BASE_URL=https://YOUR_HOSTNAME\nADDON_ACCESS_TOKEN=replace-with-32-plus-url-safe-random-characters\nTARGET_CLIENT=android-tv', 1)
text = text.replace('CATALOG_PAGE_SIZE=35', 'CATALOG_PAGE_SIZE=100', 1)
old_logo = '- `MANIFEST_LOGO_URL` defaults to `https://img.icons8.com/?size=100&id=43669&format=png&color=000000`. With this default, Stremio clients will fetch the logo from `img.icons8.com`, which can leak client IPs to that third party and makes logo availability depend on that external service. For privacy-sensitive deployments, set `MANIFEST_LOGO_URL=none` to hide the logo, or set `MANIFEST_LOGO_URL` to a self-hosted HTTPS logo URL (query parameters are allowed, e.g. `https://example.com/logo.png?v=2`).'
new_logo = '- `MANIFEST_LOGO_URL` defaults to `local`, serving the bundled logo from the add-on HTTPS origin. Set it to `none` to omit the logo, or to an explicit HTTPS URL when a separately hosted image is required.'
if old_logo not in text:
    raise RuntimeError('README: old manifest-logo guidance not found')
text = text.replace(old_logo, new_logo, 1)
text = text.replace('- `CATALOG_PAGE_SIZE` (default `35`, max effective `50`): how many cards each catalog page returns.', '- `CATALOG_PAGE_SIZE` is normalised to `100` to match Stremio pagination. Legacy lower values are accepted during upgrade but do not reduce the public page size.', 1)
readme.write_text(text)

replace_once(
    'docs/CONFIGURATION_UI.md',
    """```text
stremio://YOUR_HOST/manifest.json
https://YOUR_HOST/manifest.json
```""",
    """```text
stremio://YOUR_HOST/OPAQUE_INSTALL_TOKEN/manifest.json
https://YOUR_HOST/OPAQUE_INSTALL_TOKEN/manifest.json
```"""
)
