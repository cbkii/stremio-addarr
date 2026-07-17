from __future__ import annotations

from pathlib import Path
import textwrap

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:140]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} matches, found {count}: {old[:140]!r}")
    write(path, content.replace(old, new))


# Preserve the requested compact token flow while making every newly entered or
# generated short token exactly eight URL-safe base64 characters (48 random bits).
replace_all("src/config.ts", "{4,128}", "{8,128}", minimum=2)
replace_all("src/config.ts", "4-128 URL-safe", "8-128 URL-safe", minimum=2)
replace_all("src/config-ui-core.ts", "{4,128}", "{8,128}", minimum=1)
replace_all("src/config-ui-core.ts", "4-128 URL-safe", "8-128 URL-safe", minimum=1)

replace_once(
    "quick.sh",
    """generate_short_token() {
  openssl rand -hex 4
}""",
    """generate_short_token() {
  # Six random bytes encode to exactly eight URL-safe base64 characters.
  openssl rand -base64 6 | tr '+/' '-_' | tr -d '=\\n'
}""",
)
replace_all("quick.sh", "{4,128}", "{8,128}", minimum=1)
replace_all("quick.sh", "{4,8}", "{8}", minimum=1)
replace_all("quick.sh", "specify 4-8 characters", "specify exactly 8 characters", minimum=2)
replace_once(
    "quick.sh",
    "Enter 4-8 URL-safe characters [A-Za-z0-9_-]:",
    "Enter exactly 8 URL-safe characters [A-Za-z0-9_-]:",
)
replace_once(
    "quick.sh",
    "Use 4-8 characters containing only letters, numbers, _ or -.",
    "Use exactly 8 characters containing only letters, numbers, _ or -.",
)

for path in ["Caddyfile.example", "Caddyfile.duckdns.example", "Caddyfile.desec.example", "README_HOST.md"]:
    replace_all(path, "{4,128}", "{8,128}", minimum=1)

# Explicit skip options make the configured page size part of the manifest
# contract instead of relying on a client assuming 100-item increments.
replace_once(
    "src/addon.ts",
    """  const catalogHardMax = 100;
  const catalogPageSize = Math.max(1, Math.min(config.catalogPageSize, catalogHardMax));
  const builder = new addonBuilder({""",
    """  const catalogHardMax = 100;
  const catalogPageSize = Math.max(1, Math.min(config.catalogPageSize, catalogHardMax));
  // Stremio supports explicit skip steps. Advertise 100 pages using the
  // configured page size so sub-100 responses continue paginating predictably.
  const catalogSkipOptions = Array.from({ length: 101 }, (_, page) => String(page * catalogPageSize));
  const builder = new addonBuilder({""",
)
replace_once(
    "src/addon.ts",
    "{ name: 'skip', isRequired: false }",
    "{ name: 'skip', options: catalogSkipOptions, isRequired: false }",
)
replace_once(
    "src/addon.ts",
    "{ id: 'sonarr-recent', type: 'series', name: 'Recent on Sonarr', extra: [{ name: 'skip', isRequired: false }] }",
    "{ id: 'sonarr-recent', type: 'series', name: 'Recent on Sonarr', extra: [{ name: 'skip', options: catalogSkipOptions, isRequired: false }] }",
)
replace_once(
    "src/addon.ts",
    "// Stremio opens `${addonOrigin}/configure` for configurable add-ons.",
    "// Stremio derives Configure from the installed manifest transport path.",
)

# Manifest regression: configured 30-card pages advertise 30-based skip steps.
replace_once(
    "test/addon.test.ts",
    """      logo: string;
    };""",
    """      logo: string;
      catalogs: Array<{ id: string; extra?: Array<{ name: string; options?: string[] }> }>;
    };""",
)
replace_once(
    "test/addon.test.ts",
    """    assert.deepEqual(manifest.idPrefixes, ['tt']);
    assert.equal(manifest.logo, buildDefaultManifestLogoUrl('http://127.0.0.1:7010', '0.1.0-test'));""",
    """    assert.deepEqual(manifest.idPrefixes, ['tt']);
    assert.equal(manifest.logo, buildDefaultManifestLogoUrl('http://127.0.0.1:7010', '0.1.0-test'));
    const radarrCatalog = manifest.catalogs.find((catalog) => catalog.id === 'radarr-recent');
    const skip = radarrCatalog?.extra?.find((item) => item.name === 'skip');
    assert.deepEqual(skip?.options?.slice(0, 4), ['0', '30', '60', '90']);""",
)

# Tighten token tests from a permissive 4-char floor to exactly eight for new
# short values while keeping longer legacy values accepted by runtime parsing.
replace_once(
    "test/config-ui-hardening.test.ts",
    """test('enabled configuration UI rejects an administrator token shorter than four characters', () => {
  process.env['CONFIG_UI_TOKEN'] = 'abc';
  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be 4-128 URL-safe characters/);
});""",
    """test('enabled configuration UI rejects an administrator token shorter than eight characters', () => {
  process.env['CONFIG_UI_TOKEN'] = 'abcdefg';
  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be 8-128 URL-safe characters/);
});""",
)
replace_once(
    "test/config.test.ts",
    """test('short add-on access tokens are accepted while three-character tokens are rejected', () => {
  process.env.ADDON_ACCESS_TOKEN = 'a1B2_c3D';
  assert.equal(loadConfig().addonAccessToken, 'a1B2_c3D');
  process.env.ADDON_ACCESS_TOKEN = 'abc';
  assert.throws(() => loadConfig(), /ADDON_ACCESS_TOKEN must be 4-128/);
});""",
    """test('eight-character add-on access tokens are accepted while seven-character tokens are rejected', () => {
  process.env.ADDON_ACCESS_TOKEN = 'a1B2_c3D';
  assert.equal(loadConfig().addonAccessToken, 'a1B2_c3D');
  process.env.ADDON_ACCESS_TOKEN = 'abcdefg';
  assert.throws(() => loadConfig(), /ADDON_ACCESS_TOKEN must be 8-128/);
});

test('longer legacy add-on access tokens remain accepted', () => {
  process.env.ADDON_ACCESS_TOKEN = 'legacy-token-that-is-longer-than-eight';
  assert.equal(loadConfig().addonAccessToken, 'legacy-token-that-is-longer-than-eight');
});""",
)

# Permanent shell and installer-contract regression coverage.
write(
    "test/quick-script.test.ts",
    textwrap.dedent(
        """\
        import test from 'node:test';
        import assert from 'node:assert/strict';
        import { execFileSync } from 'node:child_process';
        import { readFileSync } from 'node:fs';
        import path from 'node:path';
        import { fileURLToPath } from 'node:url';

        const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
        const quick = readFileSync(path.join(root, 'quick.sh'), 'utf8');

        test('quick.sh has valid Bash syntax', () => {
          assert.doesNotThrow(() => execFileSync('bash', ['-n', 'quick.sh'], { cwd: root, stdio: 'pipe' }));
        });

        test('quick.sh exposes the protected URL and exact eight-character token flow', () => {
          assert.match(quick, /generate_short_token/);
          assert.match(quick, /openssl rand -base64 6/);
          assert.match(quick, /specify exactly 8 characters/);
          assert.match(quick, /PUBLIC_MANIFEST_URL=.*ADDON_ACCESS_TOKEN.*manifest\.json/);
          assert.match(quick, /PUBLIC_CONFIGURE_URL=.*ADDON_ACCESS_TOKEN.*configure/);
          assert.doesNotMatch(quick, /Public HTTPS manifest endpoint responds/);
        });

        test('upgrade merge ignores commented environment examples', () => {
          assert.match(quick, /if \(line ~ \/\^\[\[:space:\]\]\*#\/\) continue/);
        });
        """
    ),
)

# Align all user-facing guidance with exact-eight new values and 48-bit random generation.
for path in [".env.example", "README.md", "docs/CONFIGURATION_UI.md", "CHANGELOG.md"]:
    content = read(path)
    content = content.replace("4-128 URL-safe", "8-128 URL-safe")
    content = content.replace("4–128 URL-safe", "8–128 URL-safe")
    content = content.replace("4-8 character", "8-character")
    content = content.replace("4–8 character", "8-character")
    content = content.replace("4-to-8-url-safe-characters", "exactly-8-url-safe-characters")
    content = content.replace("openssl rand -hex 4", "openssl rand -base64 6 | tr '+/' '-_' | tr -d '=\\n'")
    write(path, content)

replace_once(
    "README.md",
    "The installer can keep an existing value, accept a user-specified 8-character URL-safe value, or generate a random 8-character value.",
    "The installer can keep an existing valid value, accept a user-specified 8-character URL-safe value, or generate a random 8-character URL-safe value from 48 random bits.",
)
replace_once(
    "CHANGELOG.md",
    "Add an interactive token wizard to `quick.sh`: keep an existing token, specify an 8-character value, or generate a random 8-character value.",
    "Add an interactive token wizard to `quick.sh`: keep an existing valid token, specify an 8-character value, or generate an 8-character URL-safe value from 48 random bits.",
)

# Explain why 30-card pages remain complete despite Stremio's common 100-item default.
replace_once(
    "README.md",
    "- `CATALOG_PAGE_SIZE` is configurable from `10` to `100` (default `30`). Lower values reduce work per request on a Pi; increase it only when larger catalogue pages are useful.",
    "- `CATALOG_PAGE_SIZE` is configurable from `10` to `100` (default `30`). The manifest advertises matching `skip` steps so pagination follows the configured size; lower values reduce work per request on a Pi.",
)
replace_once(
    "docs/CONFIGURATION_UI.md",
    "`CATALOG_PAGE_SIZE` is editable from 10 to 100 and defaults to 30. Smaller pages reduce work per request on a Raspberry Pi; 100 is available for operators who prefer larger pages.",
    "`CATALOG_PAGE_SIZE` is editable from 10 to 100 and defaults to 30. The manifest advertises matching `skip` steps so Stremio can request subsequent pages at that size. Smaller pages reduce work per request on a Raspberry Pi; 100 remains available.",
)

print('Applied final pagination, exact-eight token and installer-test hardening.')
