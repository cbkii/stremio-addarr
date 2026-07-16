from pathlib import Path


def replace_if_present(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old in text:
        file.write_text(text.replace(old, new))

# Source and regression test may already be present from a prior validated pass.
index = Path('src/index.ts')
text = index.read_text()
if 'export function redactAddonRequestPath' not in text:
    text = text.replace(
        'export function createApp(config: AppConfig) {',
        """export function redactAddonRequestPath(requestPath: string, addonPrefix: string): string {
  return requestPath === addonPrefix || requestPath.startsWith(`${addonPrefix}/`)
    ? `/<protected>${requestPath.slice(addonPrefix.length)}`
    : requestPath;
}

export function createApp(config: AppConfig) {""",
        1
    )
text = text.replace('path: req.path,', 'path: redactAddonRequestPath(req.path, addonPrefix),')
index.write_text(text)

test = Path('test/release-hardening.test.ts')
text = test.read_text()
text = text.replace("import { createApp } from '../src/index.js';", "import { createApp, redactAddonRequestPath } from '../src/index.js';")
if "request logging redacts the opaque add-on path token" not in text:
    marker = "test('stream adapter rejects protocol-invalid source-less streams', () => {"
    addition = """test('request logging redacts the opaque add-on path token', () => {
  assert.equal(
    redactAddonRequestPath('/secret-install-token/stream/movie/tt123.json', '/secret-install-token'),
    '/<protected>/stream/movie/tt123.json'
  );
  assert.equal(redactAddonRequestPath('/healthz', '/secret-install-token'), '/healthz');
});

"""
    text = text.replace(marker, addition + marker, 1)
test.write_text(text)

# Operator docs use the required opaque path everywhere and accurately describe the opt-in UI.
replace_if_present('README.md', '$PUBLIC_BASE_URL/manifest.json', '$PUBLIC_BASE_URL/$ADDON_ACCESS_TOKEN/manifest.json')
replace_if_present('README.md', 'https://YOUR_HOSTNAME/manifest.json', 'https://YOUR_HOSTNAME/OPAQUE_INSTALL_TOKEN/manifest.json')
replace_if_present('README.md', '"https://$PUBLIC_BASE_URL/status.json"', '"$PUBLIC_BASE_URL/status.json"')
replace_if_present('README.md', '"path":"/stream/movie/tt1234567"', '"path":"/<protected>/stream/movie/tt1234567"')
replace_if_present('README.md', 'startswith("/stream/")', 'startswith("/<protected>/stream/")')

p = Path('docs/CONFIGURATION_UI.md')
text = p.read_text()
text = text.replace(
    "`stremio-addarr` advertises Stremio's standard `configurable` behaviour hint. The **Configure** action opens:",
    "When `CONFIG_UI_ENABLED=true`, `stremio-addarr` advertises Stremio's standard `configurable` behaviour hint. The **Configure** action opens:"
)
text = text.replace(
    'CONFIG_UI_TOKEN=replace-with-the-generated-value\nCONFIG_UI_ENV_FILE=/opt/stremio-addarr/.env',
    'CONFIG_UI_ENABLED=true\nCONFIG_UI_TOKEN=replace-with-the-generated-value\nCONFIG_UI_ENV_FILE=/opt/stremio-addarr/.env'
)
text = text.replace(
    'When `CONFIG_UI_TOKEN` is absent or shorter than 12 characters, `/configure` remains available but editing is disabled. Existing `.env` installations and manifest URLs continue to work.',
    'When `CONFIG_UI_ENABLED` is false, `/configure` and the Configure behaviour hint are not exposed. When enabled, `CONFIG_UI_TOKEN` must be at least 16 characters. Existing environment-managed installations remain supported, but release 1.6 requires reinstalling through the tokenised manifest URL.'
)
p.write_text(text)
