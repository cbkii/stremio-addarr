from __future__ import annotations

from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace(path: str, old: str, new: str) -> None:
    target = ROOT / path
    content = target.read_text(encoding="utf-8")
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old!r}")
    target.write_text(content.replace(old, new, 1), encoding="utf-8")


replace(
    ".env.example",
    "# Stremio's Configure action opens PUBLIC_BASE_URL/configure.",
    "# Stremio's Configure action opens PUBLIC_BASE_URL/<ADDON_ACCESS_TOKEN>/configure.",
)
replace(
    ".env.example",
    "# Generate one with: openssl rand -base64 32",
    "# Generate an 8-character value with: openssl rand -hex 4",
)
replace(
    ".env.example",
    "#CONFIG_UI_TOKEN=replace-with-a-long-random-token",
    "#CONFIG_UI_TOKEN=replace-with-4-to-8-url-safe-characters",
)
replace(
    ".env.example",
    "#   openssl rand -base64 48 | tr -d '=+/' | cut -c1-48",
    "#   openssl rand -hex 4",
)
replace(
    "README.md",
    "## Release 1.6 security and compatibility requirements",
    "## Release 1.6+ security and compatibility requirements",
)
replace(
    "README.md",
    "- Set a unique `ADDON_ACCESS_TOKEN` (32-128 URL-safe characters). Install Stremio using the protected URL shown by the authenticated configuration UI; unprefixed manifest, catalogue and stream routes are intentionally unavailable.",
    "- Set a unique `ADDON_ACCESS_TOKEN` (4-128 URL-safe characters). New installs generate 8 characters and existing longer values remain valid. Install Stremio using the protected URL shown by the authenticated configuration UI; unprefixed manifest, catalogue and stream routes are intentionally unavailable.",
)
replace(
    "README.md",
    "- Stremio catalogue pages are fixed at 100 items so Android TV does not stop pagination early.",
    "- `CATALOG_PAGE_SIZE` is configurable from 10 to 100 and defaults to 30 for lower Pi and Arr request load.",
)
replace(
    "README.md",
    "- The configuration dashboard is a single-tenant server administration surface. Enable it explicitly with `CONFIG_UI_ENABLED=true` and a 16+ character `CONFIG_UI_TOKEN`.",
    "- The configuration dashboard is a single-tenant server administration surface. Enable it explicitly with `CONFIG_UI_ENABLED=true` and a 4-128 character URL-safe `CONFIG_UI_TOKEN`; new installs generate 8 characters.",
)
replace(
    "docs/CONFIGURATION_UI.md",
    "https://YOUR_PUBLIC_BASE_URL/ADDON_ACCESS_TOKEN/configure",
    "https://YOUR_PUBLIC_BASE_URL/<ADDON_ACCESS_TOKEN>/configure",
)
replace(
    "docs/CONFIGURATION_UI.md",
    "Add a long random administrator token to the same environment file used by the systemd service:",
    "Let `quick.sh` generate an 8-character token, or add a 4-8 character URL-safe administrator token to the same environment file used by the systemd service:",
)
replace(
    "docs/CONFIGURATION_UI.md",
    "openssl rand -base64 32",
    "openssl rand -hex 4",
)

print("Updated remaining short-token, Configure-route and catalogue guidance.")
