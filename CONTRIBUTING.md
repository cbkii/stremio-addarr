# Contributing and development

This guide is for contributors and maintainers. End users should start with [README.md](README.md).

## Development requirements

- Node.js 20.11 or newer
- npm
- Git
- Linux, macOS or WSL for the full shell/release workflow

Clone and install locked dependencies:

```bash
git clone https://github.com/cbkii/stremio-addarr.git
cd stremio-addarr
npm ci
```

Create a local configuration:

```bash
cp .env.example .env
nano .env
```

Use test credentials and non-production paths where practical.

## Run locally

```bash
npm run dev
```

The development server reads `.env` and normally listens on `127.0.0.1:7010`.

For a production-style build:

```bash
npm run build
npm start
```

## Required checks

Run the complete maintained suite before opening or updating a pull request:

```bash
npm run ci
```

This includes:

- TypeScript type checking;
- all Node tests;
- production compilation;
- Stremio manifest linting.

Useful focused commands:

```bash
npm run typecheck
npm test
npm run test:catalog
npm run build
npm run lint:manifest
bash -n quick.sh
```

Build the release archive when changing installation, packaging or documentation files:

```bash
npm run package:release

tar -tzf dist/stremio-addarr-install.tar.gz | sort
sha256sum -c dist/stremio-addarr-install.tar.gz.sha256
```

## Repository layout

| Path | Purpose |
|---|---|
| `src/` | TypeScript runtime, Stremio handlers, Arr clients and services. |
| `assets/` | Configure UI JavaScript, CSS and logo. |
| `test/` | Node/TypeScript regression tests. |
| `quick.sh` | Guided release installer and upgrader. |
| `deploy/` | systemd deployment examples. |
| `docs/` | End-user configuration and troubleshooting guides. |
| `.github/workflows/` | CI and release workflows. |
| `.github/release-body.md.tmpl` | Generated GitHub release body template. |
| `scripts/package-release.mjs` | Release archive staging and validation. |

## Change guidelines

- Keep runtime changes typed and covered by focused tests.
- Preserve existing `.env` compatibility unless a migration is documented and tested.
- Keep Android TV labels short and single-line.
- Treat `ADDON_ACCESS_TOKEN` and `CONFIG_UI_TOKEN` as separate concepts.
- Do not reintroduce unprotected `/manifest.json`, catalogue or stream routes.
- Keep the README focused on end-user installation and operation; place detailed configuration, troubleshooting and development material in the linked guides.
- Update `CHANGELOG.md` under **Unreleased** for user-visible changes.

## Documentation rules

Avoid copying the same long instructions into several files:

- `README.md` is the concise end-user entry point.
- `README_HOST.md` owns public HTTPS/Caddy guidance.
- `docs/CONFIGURATION.md` owns server setting explanations.
- `docs/CONFIGURATION_UI.md` owns Configure dashboard behaviour.
- `docs/TROUBLESHOOTING.md` owns diagnostics and recovery.
- `docs/TRAKT.md` owns watched-sync setup.
- `.env.example` is the exhaustive environment-variable/default reference.

Cross-link to the canonical guide instead of maintaining duplicate command blocks.

## Pull requests

Use a focused branch and explain:

- the user-visible problem;
- the root cause;
- the implementation;
- compatibility or migration effects;
- exact validation performed.

Before marking a PR ready:

```bash
npm ci
npm run ci
npm run package:release
bash -n quick.sh
```

Review all changed files, unresolved threads and workflow results. Remove temporary scripts, generated diagnostics and one-shot workflows from the final diff.

## Release workflow

The release workflow builds and verifies:

- `stremio-addarr-install.tar.gz`;
- archive checksum;
- standalone `quick.sh`;
- `quick.sh` checksum;
- generated release notes from `.github/release-body.md.tmpl`.

Use the repository's release dry-run for release-affecting changes. The dry-run must complete without publishing a tag or release.

When editing the release template, keep all install and verification URLs token-prefixed:

```text
https://HOST/ADDON_ACCESS_TOKEN/manifest.json
https://HOST/ADDON_ACCESS_TOKEN/configure
```

The unprefixed `/manifest.json` route is intentionally invalid.

## Logging during development

Logs are structured JSON. For readable output:

```bash
npm run dev 2>&1 | jq .
```

Use `LOG_LEVEL=debug` only while investigating a problem. Never commit real API keys, OAuth credentials, tokens or protected manifest URLs.
