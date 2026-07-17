from __future__ import annotations

from pathlib import Path
import re
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
        raise RuntimeError(f"{path}: expected one match, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new, 1))


def replace_all(path: str, old: str, new: str, minimum: int = 1) -> None:
    content = read(path)
    count = content.count(old)
    if count < minimum:
        raise RuntimeError(f"{path}: expected at least {minimum} matches, found {count}: {old[:120]!r}")
    write(path, content.replace(old, new))


def regex_once(path: str, pattern: str, replacement: str, flags: int = 0) -> None:
    content = read(path)
    updated, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise RuntimeError(f"{path}: expected one regex match, found {count}: {pattern[:120]!r}")
    write(path, updated)


# ---------------------------------------------------------------------------
# Runtime configuration: short generated tokens with legacy compatibility,
# and configurable catalogue pages restored to a Pi-friendly default.
# ---------------------------------------------------------------------------
replace_once(
    "src/config.ts",
    """  const requestedCatalogPageSize = readNumber('CATALOG_PAGE_SIZE', 100);\n  if (!Number.isInteger(requestedCatalogPageSize) || requestedCatalogPageSize <= 0) {\n    throw new Error('CATALOG_PAGE_SIZE must be a positive integer.');\n  }\n  // Stremio requests pagination in 100-item steps and treats shorter pages as end-of-catalog.\n  // Normalise legacy values instead of breaking upgrades from earlier 35/50-card defaults.\n  const catalogPageSize = 100;""",
    """  const requestedCatalogPageSize = readNumber('CATALOG_PAGE_SIZE', 30);\n  if (!Number.isInteger(requestedCatalogPageSize) || requestedCatalogPageSize < 10 || requestedCatalogPageSize > 100) {\n    throw new Error('CATALOG_PAGE_SIZE must be an integer between 10 and 100.');\n  }\n  const catalogPageSize = requestedCatalogPageSize;""",
)
replace_once(
    "src/config.ts",
    """  if (!/^[A-Za-z0-9_-]{32,128}$/.test(addonAccessToken)) {\n    throw new Error('ADDON_ACCESS_TOKEN must be 32-128 URL-safe characters (letters, numbers, _ or -).');\n  }""",
    """  if (!/^[A-Za-z0-9_-]{4,128}$/.test(addonAccessToken)) {\n    throw new Error('ADDON_ACCESS_TOKEN must be 4-128 URL-safe characters (letters, numbers, _ or -). New installs generate 8 characters; longer legacy tokens remain valid.');\n  }""",
)
replace_once(
    "src/config.ts",
    """  if (configUiEnabled && token.length < 16) {\n    throw new Error('CONFIG_UI_TOKEN must be at least 16 characters when CONFIG_UI_ENABLED=true.');\n  }""",
    """  if (configUiEnabled && !/^[A-Za-z0-9_-]{4,128}$/.test(token)) {\n    throw new Error('CONFIG_UI_TOKEN must be 4-128 URL-safe characters when CONFIG_UI_ENABLED=true. New installs generate 8 characters; longer legacy tokens remain valid.');\n  }""",
)

# ---------------------------------------------------------------------------
# Configure UI server: token-derived route, real catalogue setting, clearer UI.
# ---------------------------------------------------------------------------
replace_once(
    "src/config-ui-core.ts",
    "import { addonManifestUrl, stremioInstallUrl } from './lib/addon-access.js';",
    "import { addonBasePath, addonManifestUrl, stremioInstallUrl } from './lib/addon-access.js';",
)
replace_once(
    "src/config-ui-core.ts",
    """    catalog: {\n      pageSize: 100,\n      watchedKeepCount: parseInteger(pending.get('RADARR_CATALOG_WATCHED_KEEP_COUNT'), config.radarrCatalogWatchedKeepCount)\n    },""",
    """    catalog: {\n      pageSize: parseInteger(pending.get('CATALOG_PAGE_SIZE'), config.catalogPageSize),\n      watchedKeepCount: parseInteger(pending.get('RADARR_CATALOG_WATCHED_KEEP_COUNT'), config.radarrCatalogWatchedKeepCount)\n    },""",
)
replace_once(
    "src/config-ui-core.ts",
    """  readIntegerField(catalog, 'pageSize', 100, 100, 100);\n  set('CATALOG_PAGE_SIZE', 100);""",
    """  set('CATALOG_PAGE_SIZE', readIntegerField(catalog, 'pageSize', config.catalogPageSize, 10, 100));""",
)
replace_once(
    "src/config-ui-core.ts",
    """  if (config.configUiEnabled && adminToken.length < 16) {\n    throw new Error('CONFIG_UI_TOKEN must be at least 16 characters when CONFIG_UI_ENABLED=true.');\n  }""",
    """  if (config.configUiEnabled && !/^[A-Za-z0-9_-]{4,128}$/.test(adminToken)) {\n    throw new Error('CONFIG_UI_TOKEN must be 4-128 URL-safe characters when CONFIG_UI_ENABLED=true.');\n  }""",
)
replace_once(
    "src/config-ui-core.ts",
    """  router.get('/configure', async (_req, res) => {\n    const health = await statusService.getServiceHealth();\n    res.type('html').send(configureHtml(config, health, authEnabled));\n  });""",
    """  const configurePaths = ['/configure', `${addonBasePath(config)}/configure`];\n  router.get(configurePaths, async (_req, res) => {\n    const health = await statusService.getServiceHealth();\n    res.type('html').send(configureHtml(config, health, authEnabled));\n  });""",
)
replace_once(
    "src/config-ui-core.ts",
    """      <img src=\"/assets/logo.png\" alt=\"\" class=\"logo\">\n      <div>\n        <p class=\"eyebrow\">STREMIO ADD-ON</p>\n        <h1>Arr Status &amp; Add</h1>\n        <p class=\"lede\">TV-first setup for Radarr, Sonarr, catalogues, playback and watched-state integrations.</p>\n      </div>""",
    """      <img src=\"/assets/logo.png\" alt=\"\" class=\"logo\">\n      <div>\n        <p class=\"eyebrow\">STREMIO ADD-ON</p>\n        <h1>Arr Status &amp; Add</h1>\n        <p class=\"lede\">Configure Radarr, Sonarr, catalogues and playback.</p>\n      </div>""",
)
replace_once(
    "src/config-ui-core.ts",
    """          <h2>Install and status</h2>\n          <p>Configuration changes are written atomically to the service environment file. Restart the service to activate them.</p>\n          <div class=\"actions\">\n            <a class=\"button primary\" id=\"install-link\" href=\"${escapeHtml(stremioInstallUrl(config))}\">Install in Stremio</a>\n            <button type=\"button\" id=\"copy-manifest\">Copy manifest URL</button>\n            <button type=\"button\" id=\"logout\">Lock dashboard</button>\n          </div>""",
    """          <h2>Install and status</h2>\n          <p><strong>Save server settings</strong> applies changes to this add-on after a service restart. Use <strong>Install / reinstall</strong> only for first-time installation or after changing the add-on access token.</p>\n          <div class=\"actions\">\n            <a class=\"button\" id=\"install-link\" href=\"${escapeHtml(stremioInstallUrl(config))}\">Install / reinstall in Stremio</a>\n            <button type=\"button\" id=\"copy-manifest\">Copy manifest URL</button>\n            <button type=\"button\" id=\"logout\">Lock dashboard</button>\n          </div>""",
)
replace_once(
    "src/config-ui-core.ts",
    """          <label for=\"catalog-page-size\">Cards per page</label><input id=\"catalog-page-size\" type=\"number\" min=\"100\" max=\"100\" value=\"100\" readonly aria-describedby=\"catalog-page-help\">\n          <p class=\"muted\" id=\"catalog-page-help\">Fixed at Stremio's 100-card pagination contract.</p>""",
    """          <label for=\"catalog-page-size\">Cards per page</label><input id=\"catalog-page-size\" type=\"number\" min=\"10\" max=\"100\" step=\"1\" aria-describedby=\"catalog-page-help\">\n          <p class=\"muted\" id=\"catalog-page-help\">How many cards the add-on builds per Stremio catalogue request. The default is 30; lower values reduce Pi and Arr load.</p>""",
)
replace_once(
    "src/config-ui-core.ts",
    """        <footer class=\"save-bar\">\n          <button type=\"submit\" class=\"primary\">Save configuration</button>\n          <span>Writes the managed environment file atomically; restart required.</span>\n        </footer>""",
    """        <footer class=\"save-bar\">\n          <button type=\"submit\" class=\"primary\" id=\"save-configuration\">Save server settings</button>\n          <span>Saves safely to the server. Restart the service when prompted; reinstalling in Stremio is normally unnecessary.</span>\n        </footer>""",
)

# ---------------------------------------------------------------------------
# TV/landscape presentation.
# ---------------------------------------------------------------------------
write(
    "assets/configure.css",
    textwrap.dedent(
        """\
        :root {
          color-scheme: dark;
          font-family: Roboto, Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          font-size: clamp(15px, 1.25vw, 19px);
          --bg: #0d0b13;
          --panel: #17131f;
          --panel-strong: #221b2e;
          --field: #292334;
          --button: #3b2367;
          --button-hover: #56348d;
          --accent: #8f6bd2;
          --accent-strong: #b99ae9;
          --text: #f7f4fb;
          --muted: #b7adc7;
          --success: #67db9a;
          --warning: #eac36b;
          --error: #f07986;
          --border: #463b58;
          --focus: #ffffff;
        }

        * { box-sizing: border-box; }
        html { background: var(--bg); scroll-behavior: smooth; }
        body {
          margin: 0;
          min-height: 100vh;
          color: var(--text);
          background:
            radial-gradient(circle at 8% 0%, rgba(111, 67, 177, .18), transparent 30rem),
            linear-gradient(180deg, #130f1b 0%, var(--bg) 62%);
        }
        [hidden] { display: none !important; }

        .shell {
          width: min(96vw, 1480px);
          margin: 0 auto;
          padding: 1rem 0 5.5rem;
        }
        .hero {
          display: flex;
          align-items: center;
          gap: .8rem;
          margin-bottom: .55rem;
        }
        .logo {
          width: clamp(46px, 5vw, 66px);
          aspect-ratio: 1;
          object-fit: contain;
          border-radius: 18%;
          background: rgba(255,255,255,.05);
        }
        .eyebrow {
          margin: 0 0 .12rem;
          color: var(--accent-strong);
          font-size: .63rem;
          font-weight: 800;
          letter-spacing: .14em;
        }
        h1, h2 { margin-top: 0; line-height: 1.12; }
        h1 { margin-bottom: .15rem; font-size: clamp(1.45rem, 2.4vw, 2rem); }
        h2 { margin-bottom: .65rem; font-size: clamp(1.12rem, 1.7vw, 1.45rem); }
        .lede { margin: 0; color: var(--muted); font-size: .88rem; }

        .status-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: .55rem;
          margin: .55rem 0 .85rem;
        }
        .status-card {
          min-height: 42px;
          display: flex;
          align-items: center;
          gap: .55rem;
          padding: .48rem .7rem;
          border: 1px solid var(--border);
          border-radius: 10px;
          background: rgba(34, 27, 46, .82);
        }
        .status-card::before {
          content: "";
          flex: 0 0 10px;
          width: 10px;
          height: 10px;
          border-radius: 50%;
          background: var(--warning);
          box-shadow: 0 0 0 3px rgba(234,195,107,.12);
        }
        .status-card[data-state="online"]::before { background: var(--success); box-shadow: 0 0 0 3px rgba(103,219,154,.12); }
        .status-card[data-state="disabled"]::before { background: var(--muted); box-shadow: none; }
        .status-card[data-state="error"]::before { background: var(--error); box-shadow: 0 0 0 3px rgba(240,121,134,.12); }
        .status-card span { color: var(--muted); font-size: .76rem; }
        .status-card strong { margin-left: auto; font-size: .88rem; white-space: nowrap; }

        .panel {
          margin: .7rem 0;
          padding: clamp(.85rem, 1.6vw, 1.25rem);
          border: 1px solid var(--border);
          border-radius: 14px;
          background: rgba(23, 19, 31, .97);
          box-shadow: 0 12px 36px rgba(0,0,0,.2);
        }
        .panel > :last-child { margin-bottom: 0; }
        .stack { display: grid; gap: .55rem; }

        .config-section {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: .65rem 1rem;
          align-items: start;
        }
        .config-section > h2,
        .config-section > p,
        .config-section > hr,
        .config-section > .actions,
        .config-section > .message,
        .config-section > .toggle-row,
        .config-section > details,
        .config-section > output { grid-column: 1 / -1; }
        .field { min-width: 0; }
        .field label { margin: 0 0 .28rem; }
        .field-help { margin: .3rem 0 0; color: var(--muted); font-size: .76rem; line-height: 1.35; }

        label { display: block; margin: .75rem 0 .3rem; font-weight: 700; }
        input, select, button, .button {
          min-height: 46px;
          width: 100%;
          border: 2px solid var(--border);
          border-radius: 9px;
          padding: .58rem .72rem;
          color: var(--text);
          font: inherit;
          line-height: 1.15;
        }
        input, select { background: var(--field); }
        input[type="checkbox"] {
          width: 30px;
          min-width: 30px;
          height: 30px;
          min-height: 30px;
          accent-color: var(--accent);
        }
        button, .button {
          width: auto;
          min-height: 42px;
          padding: .48rem .78rem;
          cursor: pointer;
          text-align: center;
          font-weight: 800;
          text-decoration: none;
          background: var(--button);
          border-color: #68459d;
        }
        button:hover, .button:hover { background: var(--button-hover); border-color: var(--accent-strong); }
        .primary { color: #130c1e; border-color: var(--accent-strong); background: var(--accent-strong); }

        :focus-visible {
          outline: 3px solid var(--focus);
          outline-offset: 3px;
          border-color: var(--accent-strong);
          position: relative;
          z-index: 6;
          box-shadow: 0 0 0 6px rgba(143,107,210,.32);
        }

        .toggle-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: .8rem;
          min-height: 48px;
          margin: .15rem 0;
          padding: .45rem .65rem;
          border: 1px solid var(--border);
          border-radius: 9px;
          background: rgba(255,255,255,.025);
        }
        .toggle-row label { margin: 0; }

        .actions {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: .55rem;
          margin: .55rem 0;
        }
        .actions > * { flex: 0 1 auto; }

        .step-nav {
          position: sticky;
          top: 0;
          z-index: 10;
          display: flex;
          gap: .4rem;
          overflow-x: auto;
          padding: .55rem 0;
          background: linear-gradient(180deg, var(--bg) 76%, transparent);
        }
        .step-nav button {
          flex: 0 0 auto;
          min-height: 40px;
          padding: .45rem .7rem;
          white-space: nowrap;
        }
        .step-nav button[aria-current="page"] {
          color: #160d22;
          border-color: var(--accent-strong);
          background: var(--accent-strong);
        }

        .message { min-height: 1.2em; color: var(--muted); line-height: 1.35; }
        .message[data-state="success"] { color: var(--success); }
        .message[data-state="warning"] { color: var(--warning); }
        .message[data-state="error"] { color: var(--error); }
        .muted { color: var(--muted); font-weight: 500; font-size: .8em; }
        .code, code { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; overflow-wrap: anywhere; }
        .code { display: block; padding: .62rem; border-radius: 8px; background: #09070d; color: #dfd3f3; font-size: .8rem; }
        hr { margin: .7rem 0; border: 0; border-top: 1px solid var(--border); }
        details { margin: .35rem 0; padding: .65rem .8rem; border: 1px solid var(--border); border-radius: 9px; }
        summary { cursor: pointer; font-weight: 800; }
        details[open] { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: .6rem 1rem; }
        details[open] > summary, details[open] > p { grid-column: 1 / -1; }

        .save-bar {
          position: sticky;
          bottom: 0;
          z-index: 9;
          display: flex;
          align-items: center;
          gap: .8rem;
          margin-top: .75rem;
          padding: .55rem .65rem;
          border: 1px solid var(--border);
          border-radius: 11px;
          background: rgba(13,11,19,.96);
          backdrop-filter: blur(10px);
        }
        .save-bar button { flex: 0 0 auto; }
        .save-bar span { color: var(--muted); font-size: .75rem; }

        @media (orientation: landscape) and (min-width: 900px) {
          .shell { width: min(97vw, 1560px); }
          .panel { padding: 1rem 1.2rem; }
        }
        @media (max-width: 800px) {
          .shell { width: min(94vw, 760px); }
          .hero { align-items: center; }
          .status-grid { grid-template-columns: 1fr; }
          .config-section, details[open] { grid-template-columns: 1fr; }
          .step-nav { position: static; display: grid; grid-template-columns: 1fr 1fr; overflow: visible; }
          .step-nav button { width: 100%; }
          .actions, .save-bar { align-items: stretch; }
          .actions > *, .save-bar button { width: 100%; }
          .save-bar { flex-direction: column; }
        }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after { scroll-behavior: auto !important; transition: none !important; }
        }
        """
    ),
)

# ---------------------------------------------------------------------------
# Client UI: field help, compact status, clear actions and deterministic D-pad.
# ---------------------------------------------------------------------------
replace_once("assets/configure.js", "byId('catalog-page-size').value = 100;", "byId('catalog-page-size').value = catalog.pageSize;")
replace_once("assets/configure.js", "      pageSize: 100,", "      pageSize: readNumber('catalog-page-size'),")
replace_once("assets/configure.js", "    byId('install-link').focus();", "    document.querySelector('[data-section=\"overview\"]')?.focus();")

replace_once(
    "assets/configure.js",
    """document.addEventListener('keydown', (event) => {\n  if (event.key === 'Escape' || event.key === 'BrowserBack') {\n    const overviewVisible = !document.querySelector('[data-page=\"overview\"]').hidden;\n    if (!overviewVisible && !dashboard.hidden) {\n      event.preventDefault();\n      showPage('overview');\n      document.querySelector('[data-section=\"overview\"]')?.focus();\n    }\n  }\n});\n\nloadConfiguration();""",
    """document.addEventListener('keydown', (event) => {\n  if (event.key !== 'Escape' && event.key !== 'BrowserBack') return;\n  const active = document.activeElement;\n  if (active instanceof HTMLInputElement || active instanceof HTMLSelectElement) {\n    event.preventDefault();\n    active.blur();\n    const page = active.closest('[data-page]')?.dataset.page || 'overview';\n    document.querySelector(`[data-section=\"${page}\"]`)?.focus();\n    return;\n  }\n  const overview = document.querySelector('[data-page=\"overview\"]');\n  if (overview && !overview.hidden && !dashboard.hidden) return;\n  if (!dashboard.hidden) {\n    event.preventDefault();\n    showPage('overview');\n    document.querySelector('[data-section=\"overview\"]')?.focus();\n  }\n});\n\nenhanceConfigurationUi();\nloadConfiguration();""",
)

regex_once(
    "assets/configure.js",
    r"function moveTvFocus\(direction\) \{.*?document\.addEventListener\('keydown', \(event\) => \{\n  const direction = \{ ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' \}\[event\.key\];\n  if \(!direction\) return;\n  const active = document\.activeElement;\n  if \(active instanceof HTMLInputElement && \['text', 'password', 'number'\]\.includes\(active\.type\)\) return;\n  event\.preventDefault\(\);\n  moveTvFocus\(direction\);\n\}\);\n?$",
    textwrap.dedent(
        r"""
        const FIELD_HELP = {
          'radarr-url': 'The URL this Pi uses to reach Radarr, including http:// or https:// and its port.',
          'radarr-card-url': 'Optional user-facing Radarr URL shown on cards. Leave blank to reuse the server URL.',
          'radarr-key': 'Used only by the server. Leave blank to keep the existing key.',
          'radarr-root': 'Folder Radarr will use for movies added from Stremio.',
          'radarr-profile': 'Radarr quality profile applied to newly added movies.',
          'radarr-minimum': 'Earliest release stage at which Radarr is allowed to consider a movie available.',
          'radarr-tags': 'Optional comma-separated Radarr tag IDs, for example 1,3.',
          'sonarr-url': 'The URL this Pi uses to reach Sonarr, including http:// or https:// and its port.',
          'sonarr-card-url': 'Optional user-facing Sonarr URL shown on cards. Leave blank to reuse the server URL.',
          'sonarr-key': 'Used only by the server. Leave blank to keep the existing key.',
          'sonarr-root': 'Folder Sonarr will use for series added from Stremio.',
          'sonarr-profile': 'Sonarr quality profile applied to newly added series.',
          'sonarr-language': 'Only Sonarr v3 uses language profiles. Leave as Not used for Sonarr v4.',
          'sonarr-monitor': 'Which episodes Sonarr marks as monitored when an item is added from a Stremio episode page.',
          'sonarr-new-items': 'Controls whether future episodes become monitored after the initial add. Automatic follows the selected monitoring mode.',
          'sonarr-tags': 'Optional comma-separated Sonarr tag IDs, for example 2,4.',
          'episode-timeout': 'Maximum time to wait for Sonarr to create episode records after a new series is added.',
          'episode-poll': 'Delay between Sonarr episode-readiness checks. Smaller values poll more often.',
          'ep-count': 'In Selected episode mode, switch to the threshold upgrade mode after this many nearby prior episodes are downloaded. Use 0 or 1 to disable.',
          'ep-count-past': 'Maximum number of earlier episodes checked when applying the downloaded-episode threshold.',
          'ep-count-mod': 'Monitoring scope used when the downloaded-episode threshold is met.',
          'catalog-page-size': 'Cards built per request. Default 30; choose 10–100. Lower values reduce Pi and Arr load.',
          'catalog-watched-keep': 'Number of watched Radarr movies still retained in filtered catalogue views.',
          'kodi-package': 'Android package name used by the Kodi fallback intent. Standard Kodi is org.xbmc.kodi.',
          'playback-mode': 'Direct serves an existing file from this Pi; Kodi opens the item in Kodi when direct playback is unavailable.',
          'trakt-sync-mins': 'How often watched history is refreshed. Minimum 40 minutes.',
          'trakt-api-url': 'Normally https://api.trakt.tv. Change only for a compatible proxy.',
          'trakt-client-id': 'Leave blank to keep the stored Trakt client ID.',
          'trakt-client-secret': 'Leave blank to keep the stored Trakt client secret.',
          'trakt-refresh-token': 'Leave blank to keep the stored OAuth refresh token.',
          'trakt-redirect-uri': 'Must match the redirect URI configured for the Trakt application.',
          'tmdb-api-url': 'Normally https://api.themoviedb.org.',
          'tmdb-token': 'Optional TMDB read-access token used only as a release-date fallback.',
          'tmdb-region': 'Two-letter region used for release dates, for example AU.'
        };

        function enhanceConfigurationUi() {
          document.querySelectorAll('.status-card').forEach((card) => {
            const state = card.querySelector('strong')?.textContent?.trim().toLowerCase() || '';
            card.dataset.state = state === 'connected' || state === 'ready'
              ? 'online'
              : state === 'disabled' ? 'disabled' : 'error';
          });

          document.querySelectorAll('.config-section label[for]').forEach((label) => {
            if (label.closest('.toggle-row') || label.closest('.field')) return;
            const control = document.getElementById(label.htmlFor);
            if (!control || control.closest('.field')) return;
            const field = document.createElement('div');
            field.className = 'field';
            label.parentNode.insertBefore(field, label);
            field.append(label, control);
            const description = FIELD_HELP[control.id];
            if (description) {
              const help = document.createElement('p');
              help.className = 'field-help';
              help.id = `${control.id}-help`;
              help.textContent = description;
              field.append(help);
              const describedBy = [control.getAttribute('aria-describedby'), help.id].filter(Boolean).join(' ');
              control.setAttribute('aria-describedby', describedBy);
            }
          });

          const installLink = byId('install-link');
          installLink.textContent = 'Install / reinstall in Stremio';
          const saveButton = byId('save-configuration');
          saveButton.dataset.tvLast = 'true';
        }

        function visibleFocusable(includeSave = false) {
          return [...document.querySelectorAll('button:not([hidden]):not([disabled]), a[href]:not([hidden]), input:not([hidden]):not([disabled]), select:not([hidden]):not([disabled]), summary')]
            .filter((element) => element.getClientRects().length > 0)
            .filter((element) => includeSave || element.dataset.tvLast !== 'true');
        }

        function focusElement(element) {
          if (!(element instanceof HTMLElement)) return;
          element.focus();
          element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
        }

        function switchTab(delta) {
          const tabs = [...document.querySelectorAll('[data-section]')];
          const current = document.activeElement;
          const index = Math.max(0, tabs.indexOf(current));
          const next = tabs[(index + delta + tabs.length) % tabs.length];
          showPage(next.dataset.section);
          focusElement(next);
        }

        function moveSequential(delta) {
          const current = document.activeElement;
          let focusable = visibleFocusable(false);
          let index = focusable.indexOf(current);
          if (index < 0) {
            focusElement(focusable[0]);
            return;
          }
          const movingForward = delta > 0;
          if (movingForward && index === focusable.length - 1) {
            focusable = visibleFocusable(true);
            index = focusable.indexOf(current);
          }
          const nextIndex = Math.max(0, Math.min(focusable.length - 1, index + delta));
          focusElement(focusable[nextIndex]);
        }

        document.addEventListener('focusin', (event) => {
          if (event.target instanceof HTMLElement) {
            event.target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
          }
        });

        document.addEventListener('keydown', (event) => {
          const direction = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -1, ArrowDown: 1 }[event.key];
          if (!direction) return;
          const active = document.activeElement;
          if (!(active instanceof HTMLElement)) return;

          if (active.matches('[data-section]') && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
            event.preventDefault();
            switchTab(direction);
            return;
          }

          if (active instanceof HTMLSelectElement) {
            if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
              event.preventDefault();
              moveSequential(direction);
            }
            return;
          }

          if (active instanceof HTMLInputElement) {
            if (active.type === 'number') {
              event.preventDefault();
              moveSequential(direction);
              return;
            }
            if (['text', 'password', 'url'].includes(active.type)) {
              if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
                event.preventDefault();
                moveSequential(direction);
              }
              return;
            }
          }

          event.preventDefault();
          moveSequential(direction);
        });
        """
    ).lstrip(),
    flags=re.S,
)

# ---------------------------------------------------------------------------
# Quick installer/upgrade: safe merge, token wizard, stable service checks and
# correct protected URLs in verification/output.
# ---------------------------------------------------------------------------
replace_once(
    "quick.sh",
    "for c in gh sha256sum tar npm node curl sudo file diff systemctl; do",
    "for c in gh sha256sum tar npm node curl sudo file diff systemctl openssl; do",
)
replace_once(
    "quick.sh",
    """      while ((getline line < existing_file) > 0) {\n        delete key_buf\n        delete val_buf\n        if (parse_assignment(line, key_buf, val_buf)) {""",
    """      while ((getline line < existing_file) > 0) {\n        delete key_buf\n        delete val_buf\n        # Commented examples are documentation, not configured values. Keeping\n        # them caused placeholder tokens to override real upgrade settings.\n        if (line ~ /^[[:space:]]*#/) continue\n        if (parse_assignment(line, key_buf, val_buf)) {""",
)

TOKEN_FUNCTIONS = r'''
generate_short_token() {
  openssl rand -hex 4
}

read_env_value() {
  local key="$1"
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^[[:space:]]*" key "[[:space:]]*=") {
        sub("^[[:space:]]*" key "[[:space:]]*=", "", line)
        value = line
      }
    }
    END { print value }
  ' "$INSTALL_DIR/.env"
}

is_runtime_token() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{4,128}$ ]]
}

is_short_token() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{4,8}$ ]]
}

choose_token() {
  local key="$1"
  local label="$2"
  local purpose="$3"
  local current choice value prompt
  current="$(read_env_value "$key")"

  echo
  say "$label"
  echo "$purpose"
  if is_runtime_token "$current"; then
    echo "Current value: configured (${#current} characters)."
    prompt="Choose [k] keep / [s] specify 4-8 characters / [g] generate random 8 characters [k]: "
  else
    echo "Current value: not configured or invalid."
    prompt="Choose [s] specify 4-8 characters / [g] generate random 8 characters [g]: "
  fi

  while true; do
    read -r -p "${C_YELLOW}${C_BOLD}${prompt}${C_RESET}" choice
    choice="${choice,,}"
    if [[ -z "$choice" ]]; then
      if is_runtime_token "$current"; then choice="k"; else choice="g"; fi
    fi
    case "$choice" in
      k|keep)
        if is_runtime_token "$current"; then
          ok "Keeping existing $key."
          return 0
        fi
        warn "There is no valid token to keep."
        ;;
      s|specify)
        read -r -p "${C_YELLOW}${C_BOLD}Enter 4-8 URL-safe characters [A-Za-z0-9_-]: ${C_RESET}" value
        if ! is_short_token "$value"; then
          warn "Use 4-8 characters containing only letters, numbers, _ or -."
          continue
        fi
        upsert_env_key "$key" "$value"
        ok "$key set to: $value"
        return 0
        ;;
      g|generate)
        value="$(generate_short_token)"
        upsert_env_key "$key" "$value"
        ok "$key generated: $value"
        echo "Record this value now; it is intentionally short for TV entry."
        return 0
        ;;
      *) warn "Choose keep, specify or generate." ;;
    esac
  done
}

prompt_config_ui_enabled() {
  local current answer default_prompt
  current="$(read_env_value CONFIG_UI_ENABLED)"
  case "${current,,}" in
    true|1|yes|on) current="true"; default_prompt="[Y/n]" ;;
    *) current="false"; default_prompt="[y/N]" ;;
  esac
  while true; do
    read -r -p "${C_YELLOW}${C_BOLD}Enable the Stremio/browser configuration UI? $default_prompt: ${C_RESET}" answer
    answer="${answer,,}"
    if [[ -z "$answer" ]]; then answer="$current"; fi
    case "$answer" in
      y|yes|true|1|on) upsert_env_key CONFIG_UI_ENABLED true; return 0 ;;
      n|no|false|0|off) upsert_env_key CONFIG_UI_ENABLED false; return 0 ;;
      *) warn "Please enter y or n." ;;
    esac
  done
}

configure_tokens() {
  say "Token setup"
  echo "The add-on access token forms the private Stremio manifest path."
  echo "The configuration token unlocks server settings and is never part of the manifest URL."
  echo "New random tokens are 8 characters. Existing longer tokens remain supported."

  choose_token ADDON_ACCESS_TOKEN "Add-on access token" \
    "Used in /<token>/manifest.json and /<token>/configure."

  prompt_config_ui_enabled
  if [[ "$(read_env_value CONFIG_UI_ENABLED)" == "true" ]]; then
    choose_token CONFIG_UI_TOKEN "Configuration UI token" \
      "Entered on the Configure page to unlock editing."
  else
    warn "Configuration UI disabled; /configure will not be exposed."
  fi

  local logo
  logo="$(read_env_value MANIFEST_LOGO_URL)"
  if [[ "$logo" == *'${PUBLIC_BASE_URL}'* || "$logo" == *'$PUBLIC_BASE_URL'* ]]; then
    upsert_env_key MANIFEST_LOGO_URL local
    warn "Migrated MANIFEST_LOGO_URL to 'local'; systemd EnvironmentFile values do not expand nested variables."
  fi
}
'''
replace_once(
    "quick.sh",
    "\n}\n\nconfigure_trakt_oauth() {",
    "\n}\n\n" + TOKEN_FUNCTIONS.strip("\n") + "\n\nconfigure_trakt_oauth() {",
)
replace_once(
    "quick.sh",
    """wait_for_service() {\n  local svc=\"$1\"\n  local timeout=\"${2:-10}\"\n  local i=0\n  while (( i < timeout )); do\n    if systemctl is-active --quiet \"$svc\" 2>/dev/null; then\n      ok \"Service $svc is active.\"\n      return 0\n    fi\n    sleep 1\n    (( i++ )) || true\n  done\n  warn \"Service $svc did not become active within ${timeout}s.\"\n  warn \"Recent logs:\"\n  sudo journalctl -u \"$svc\" -n 20 --no-pager || true\n  return 1\n}""",
    """wait_for_service() {\n  local svc=\"$1\"\n  local timeout=\"${2:-15}\"\n  local i=0\n  local stable=0\n  while (( i < timeout )); do\n    if systemctl is-active --quiet \"$svc\" 2>/dev/null; then\n      stable=$((stable + 1))\n      if (( stable >= 3 )); then\n        ok \"Service $svc remained active for three consecutive checks.\"\n        return 0\n      fi\n    else\n      stable=0\n    fi\n    sleep 1\n    (( i++ )) || true\n  done\n  warn \"Service $svc did not remain stably active within ${timeout}s.\"\n  warn \"Recent logs from the current service invocation:\"\n  local invocation\n  invocation=\"$(systemctl show \"$svc\" -p InvocationID --value 2>/dev/null || true)\"\n  if [[ -n \"$invocation\" ]]; then\n    sudo journalctl \"_SYSTEMD_INVOCATION_ID=$invocation\" -n 40 --no-pager || true\n  else\n    sudo journalctl -u \"$svc\" -n 40 --no-pager || true\n  fi\n  return 1\n}""",
)
replace_once(
    "quick.sh",
    """    say \"Please review app config before continuing.\"""",
    """    configure_tokens\n\n    say \"Please review app config before continuing.\"""",
)
replace_once(
    "quick.sh",
    """    prompt_gate \"Review .env diff and approve.\" \"$INSTALL_DIR/.env\"""",
    """    configure_tokens\n    prompt_gate \"Review .env diff and approve.\" \"$INSTALL_DIR/.env\"""",
)
replace_once(
    "quick.sh",
    """    prompt_gate \"Review newly created .env.\" \"$INSTALL_DIR/.env\"""",
    """    configure_tokens\n    prompt_gate \"Review newly created .env.\" \"$INSTALL_DIR/.env\"""",
)
replace_once(
    "quick.sh",
    """if [[ -z \"${PUBLIC_BASE_URL:-}\" ]]; then\n  print_status_line WARN \"PUBLIC_BASE_URL is missing in .env. Configure hosting before Stremio install.\"\nelse\n  run_verification \"Public health endpoint responds.\" curl -fsS \"${PUBLIC_BASE_URL}/healthz\"\n  run_verification \"Public HTTPS manifest endpoint responds.\" curl -fI \"${PUBLIC_BASE_URL}/manifest.json\"\n  run_verification \"Public status.json endpoint responds.\" curl -fsS \"${PUBLIC_BASE_URL}/status.json\"\nfi\n\nrun_verification \"Local health endpoint responds.\" curl -fsS http://127.0.0.1:7010/healthz\nrun_verification \"Local manifest endpoint responds.\" curl -fsS http://127.0.0.1:7010/manifest.json\nrun_verification \"Local status.json endpoint responds.\" curl -fsS http://127.0.0.1:7010/status.json""",
    """PUBLIC_MANIFEST_URL=\"\"\nPUBLIC_CONFIGURE_URL=\"\"\nif [[ -z \"${PUBLIC_BASE_URL:-}\" ]]; then\n  print_status_line WARN \"PUBLIC_BASE_URL is missing in .env. Configure hosting before Stremio install.\"\nelif [[ -z \"${ADDON_ACCESS_TOKEN:-}\" ]]; then\n  print_status_line FAIL \"ADDON_ACCESS_TOKEN is missing in .env.\"\n  VERIFICATION_FAILURES=$((VERIFICATION_FAILURES + 1))\n  VERIFY_ERRORS+=(\"ADDON_ACCESS_TOKEN is missing\")\nelse\n  PUBLIC_MANIFEST_URL=\"${PUBLIC_BASE_URL%/}/${ADDON_ACCESS_TOKEN}/manifest.json\"\n  PUBLIC_CONFIGURE_URL=\"${PUBLIC_BASE_URL%/}/${ADDON_ACCESS_TOKEN}/configure\"\n  run_verification \"Public health endpoint responds.\" curl -fsS \"${PUBLIC_BASE_URL%/}/healthz\"\n  run_verification \"Public protected manifest endpoint responds.\" curl -fsS \"$PUBLIC_MANIFEST_URL\"\n  run_verification \"Public status.json endpoint responds.\" curl -fsS \"${PUBLIC_BASE_URL%/}/status.json\"\n  if [[ \"${CONFIG_UI_ENABLED:-false}\" == \"true\" ]]; then\n    run_verification \"Public token-derived Configure page responds.\" curl -fsS \"$PUBLIC_CONFIGURE_URL\"\n  fi\nfi\n\nrun_verification \"Local health endpoint responds.\" curl -fsS http://127.0.0.1:7010/healthz\nif [[ -n \"${ADDON_ACCESS_TOKEN:-}\" ]]; then\n  run_verification \"Local protected manifest endpoint responds.\" curl -fsS \"http://127.0.0.1:7010/${ADDON_ACCESS_TOKEN}/manifest.json\"\n  if [[ \"${CONFIG_UI_ENABLED:-false}\" == \"true\" ]]; then\n    run_verification \"Local token-derived Configure page responds.\" curl -fsS \"http://127.0.0.1:7010/${ADDON_ACCESS_TOKEN}/configure\"\n  fi\nfi\nrun_verification \"Local status.json endpoint responds.\" curl -fsS http://127.0.0.1:7010/status.json""",
)
replace_once(
    "quick.sh",
    """if [[ -n \"${PUBLIC_BASE_URL:-}\" ]]; then\n  echo\n  echo -e \"  ${C_BOLD}Add-on URL:${C_RESET}   ${PUBLIC_BASE_URL}/manifest.json\"\n  echo \"  Paste into Stremio: ${PUBLIC_BASE_URL}/manifest.json\"\nfi""",
    """if [[ -n \"${PUBLIC_MANIFEST_URL:-}\" ]]; then\n  echo\n  echo -e \"  ${C_BOLD}Stremio manifest:${C_RESET}  $PUBLIC_MANIFEST_URL\"\n  echo \"  Paste this exact protected URL into Stremio.\"\n  echo \"  The unprotected /manifest.json URL intentionally returns 404.\"\n  if [[ \"${CONFIG_UI_ENABLED:-false}\" == \"true\" ]]; then\n    echo -e \"  ${C_BOLD}Configure page:${C_RESET}    $PUBLIC_CONFIGURE_URL\"\n    echo \"  Save server settings there; reinstall only after first setup or an access-token change.\"\n  fi\nfi""",
)

# ---------------------------------------------------------------------------
# Examples and documentation.
# ---------------------------------------------------------------------------
replace_all(".env.example", "CATALOG_PAGE_SIZE=100", "CATALOG_PAGE_SIZE=30")
replace_all(".env.example", "Set CONFIG_UI_ENABLED=true and a random token of at least 16 characters to enable it.", "Set CONFIG_UI_ENABLED=true and a URL-safe token of at least 4 characters to enable it. New installs generate 8 characters.")
replace_all(".env.example", "Required: 32-128 URL-safe random characters.", "Required: 4-128 URL-safe characters. New installs generate a random 8-character token; longer legacy tokens remain valid.")

for caddy_path in ["Caddyfile.example", "Caddyfile.duckdns.example", "Caddyfile.desec.example"]:
    replace_once(
        caddy_path,
        "    encode zstd gzip\n    reverse_proxy 127.0.0.1:7010",
        """    encode zstd gzip\n\n    # Stremio derives /<ADDON_ACCESS_TOKEN>/configure from the protected\n    # manifest transport URL. This compatibility rewrite also supports v1.6.1.\n    @tokenConfigure path_regexp tokenConfigure ^/[A-Za-z0-9_-]{4,128}/configure$\n    rewrite @tokenConfigure /configure\n\n    reverse_proxy 127.0.0.1:7010""",
    )

replace_once(
    "scripts/package-release.mjs",
    "    'README_HOST.md',\n    'docs/CONFIGURATION_UI.md',",
    "    'README_HOST.md',\n    'CHANGELOG.md',\n    'docs/CONFIGURATION_UI.md',",
)
replace_once(
    "scripts/package-release.mjs",
    "stage('README_HOST.md');\nstage('docs', 'docs');",
    "stage('README_HOST.md');\nstage('CHANGELOG.md');\nstage('docs', 'docs');",
)

readme = read("README.md")
readme = readme.replace("ADDON_ACCESS_TOKEN=replace-with-32-plus-url-safe-random-characters", "ADDON_ACCESS_TOKEN=replace-with-4-to-8-url-safe-characters")
readme = readme.replace("CATALOG_PAGE_SIZE=100", "CATALOG_PAGE_SIZE=30")
readme = readme.replace(
    "- `CATALOG_PAGE_SIZE` is normalised to `100` to match Stremio pagination. Legacy lower values are accepted during upgrade but do not reduce the public page size.",
    "- `CATALOG_PAGE_SIZE` is configurable from `10` to `100` (default `30`). Lower values reduce work per request on a Pi; increase it only when larger catalogue pages are useful.",
)
readme = readme.replace(
    "Use the guided quick script. It keeps your existing `.env` and service wiring, reapplies ownership and dependencies, opens explicit review gates for `.env` and systemd unit changes, and runs verification checks.",
    "Use the guided quick script. It keeps your existing `.env` and service wiring, fixes legacy placeholder merges, offers keep/specify/generate choices for both tokens, reapplies ownership and dependencies, opens explicit review gates, waits for a stably running service, and verifies the protected manifest and Configure URLs.",
)
if "## Token and Configure URL rules" not in readme:
    readme += textwrap.dedent(
        """

        ---

        ## Token and Configure URL rules

        `quick.sh` handles two different tokens:

        - `ADDON_ACCESS_TOKEN` is part of the private Stremio transport path. The manifest URL is `https://HOST/<ADDON_ACCESS_TOKEN>/manifest.json` and Stremio opens Configure at `https://HOST/<ADDON_ACCESS_TOKEN>/configure`.
        - `CONFIG_UI_TOKEN` is entered inside the Configure page to unlock server-side settings. It is never placed in the manifest URL.

        The installer can keep an existing value, accept a user-specified 4–8 character URL-safe value, or generate a random 8-character value. Longer existing tokens remain valid for backward compatibility. The plain `/manifest.json` route is intentionally not the install URL.

        Saving the configuration UI updates the server `.env`; it does not install the add-on. Use **Install / reinstall in Stremio** only for first-time installation or after changing `ADDON_ACCESS_TOKEN`.

        The Configure UI supports both `/configure` and the Stremio-derived `/<ADDON_ACCESS_TOKEN>/configure` route. The canonical Caddy examples retain a harmless compatibility rewrite for v1.6.1 installations.
        """
    )
write("README.md", readme)

host = read("README_HOST.md")
host = host.replace(
    "    encode zstd gzip\n    reverse_proxy 127.0.0.1:7010",
    """    encode zstd gzip\n\n    # Stremio derives this path from /<ADDON_ACCESS_TOKEN>/manifest.json.\n    # The rewrite is required for v1.6.1 and harmless on newer releases.\n    @tokenConfigure path_regexp tokenConfigure ^/[A-Za-z0-9_-]{4,128}/configure$\n    rewrite @tokenConfigure /configure\n\n    reverse_proxy 127.0.0.1:7010""",
)
host = host.replace('curl -fI "https://$ADDARR_HOSTNAME/manifest.json"', 'curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"')
host = host.replace("curl -fsS http://127.0.0.1:7010/manifest.json >/dev/null", "curl -fsS \"http://127.0.0.1:7010/$ADDON_ACCESS_TOKEN/manifest.json\" >/dev/null")
host = host.replace('echo "https://$ADDARR_HOSTNAME/manifest.json"', 'echo "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"')
if "export ADDON_ACCESS_TOKEN" not in host:
    marker = "Run the complete verification sequence:\n\n```bash\n"
    host = host.replace(
        marker,
        marker + "export ADDON_ACCESS_TOKEN=\"$(sudo sed -n 's/^ADDON_ACCESS_TOKEN=//p' /opt/stremio-addarr/.env | tail -n1)\"\n",
        1,
    )
if "token-derived Configure" not in host:
    host += textwrap.dedent(
        """

        ## Protected Configure path

        Stremio derives the Configure URL from the installed transport URL. For a manifest installed from `https://HOST/TOKEN/manifest.json`, it opens `https://HOST/TOKEN/configure`. Current releases serve that route directly. The documented Caddy rewrite maps the same path to `/configure` for compatibility with v1.6.1.

        Verify both endpoints:

        ```bash
        curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/manifest.json"
        curl -fI "https://$ADDARR_HOSTNAME/$ADDON_ACCESS_TOKEN/configure"
        ```
        """
    )
write("README_HOST.md", host)

ui_doc = read("docs/CONFIGURATION_UI.md")
ui_doc = ui_doc.replace("When `CONFIG_UI_ENABLED=true`, When `CONFIG_UI_ENABLED=true`,", "When `CONFIG_UI_ENABLED=true`,")
ui_doc = ui_doc.replace("CONFIG_UI_ENABLED=true\nCONFIG_UI_ENABLED=true", "CONFIG_UI_ENABLED=true")
ui_doc = ui_doc.replace("When enabled, `CONFIG_UI_TOKEN` must be at least 16 characters.", "When enabled, `CONFIG_UI_TOKEN` must contain 4–128 URL-safe characters. The installer generates 8 characters by default and preserves longer legacy values.")
ui_doc = ui_doc.replace("https://YOUR_PUBLIC_BASE_URL/configure", "https://YOUR_PUBLIC_BASE_URL/ADDON_ACCESS_TOKEN/configure")
if "## Saving versus installing" not in ui_doc:
    ui_doc += textwrap.dedent(
        """

        ## Saving versus installing

        **Save server settings** validates and writes the managed `.env` values. Restart the service when the UI reports that activation is required. Saving does not require reinstalling the add-on.

        **Install / reinstall in Stremio** opens Stremio with the protected manifest URL. Use it for the first installation or after rotating `ADDON_ACCESS_TOKEN`; it is not an Apply button.

        ## TV remote navigation

        - Up/Down moves through visible controls in document order rather than jumping to the sticky save bar.
        - Left/Right moves between tabs and provides an exit path from number and select fields.
        - Number inputs no longer consume D-pad Up/Down merely to increment values.
        - Back/Escape first leaves an active field, then returns to Overview, before allowing the browser to close.
        - The form uses two columns on wide landscape displays and one column on narrow screens.

        ## Catalogue page size

        `CATALOG_PAGE_SIZE` is editable from 10 to 100 and defaults to 30. Smaller pages reduce work per request on a Raspberry Pi; 100 is available for operators who prefer larger pages.
        """
    )
write("docs/CONFIGURATION_UI.md", ui_doc)

write(
    "CHANGELOG.md",
    textwrap.dedent(
        """\
        # Changelog

        ## Unreleased

        ### Fixed

        - Serve the configuration UI at both `/configure` and the Stremio-derived `/<ADDON_ACCESS_TOKEN>/configure` path.
        - Correct `quick.sh` verification and final output to use the protected manifest URL instead of the obsolete `/manifest.json` route.
        - Stop the upgrade merge from treating commented `.env` examples as configured values, which could preserve placeholder tokens and prevent startup.
        - Require the service to remain active across consecutive checks before an install or upgrade is reported healthy.
        - Migrate nested `MANIFEST_LOGO_URL=${PUBLIC_BASE_URL}...` values to `MANIFEST_LOGO_URL=local`, because systemd `EnvironmentFile=` does not perform shell expansion.
        - Add the token-derived Configure compatibility rewrite to every Caddy example and the hosting guide.

        ### Changed

        - Add an interactive token wizard to `quick.sh`: keep an existing token, specify a 4–8 character value, or generate a random 8-character value.
        - Retain support for longer legacy tokens while making short TV-friendly tokens the default for new installations.
        - Restore configurable catalogue page sizes from 10 to 100 with a Pi-friendly default of 30.
        - Redesign the configuration UI for compact TV and landscape use, with smaller header/status/actions, purple action controls, wider responsive layouts and detailed field guidance.
        - Rework D-pad behaviour so form navigation is sequential, number inputs can be exited, tabs are predictable, Back first leaves edit mode, and the sticky save action is reached only at the end.
        - Clarify that saving changes server configuration, while Install / reinstall is only for initial installation or access-token rotation.
        """
    ),
)

# ---------------------------------------------------------------------------
# Tests.
# ---------------------------------------------------------------------------
replace_once(
    "test/config-ui-hardening.test.ts",
    """test('enabled configuration UI rejects a short administrator token at startup', () => {\n  process.env['CONFIG_UI_TOKEN'] = 'too-short';\n  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be at least 16 characters/);\n});""",
    """test('enabled configuration UI accepts an eight-character administrator token', () => {\n  process.env['CONFIG_UI_TOKEN'] = 'a1B2_c3D';\n  assert.doesNotThrow(() => createApp(uiConfig()));\n});\n\ntest('enabled configuration UI rejects an administrator token shorter than four characters', () => {\n  process.env['CONFIG_UI_TOKEN'] = 'abc';\n  assert.throws(() => createApp(uiConfig()), /CONFIG_UI_TOKEN must be 4-128 URL-safe characters/);\n});""",
)
replace_once(
    "test/config-ui.test.ts",
    """test('/configure serves a TV-first page without exposing configured secrets', async () => {\n  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';\n  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();\n  const app = createApp(uiConfig());\n\n  await withServer(app, async (baseUrl) => {\n    const response = await ORIGINAL_FETCH(`${baseUrl}/configure`);\n    const html = await response.text();\n    assert.equal(response.status, 200);\n    assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);\n    assert.match(html, /Arr Status &amp; Add/);\n    assert.match(html, /Unlock configuration/);\n    assert.match(html, /\\/assets\\/configure\\.js/);\n    assert.ok(!html.includes('value=\"radarr-key\"'));\n    assert.ok(!html.includes('value=\"sonarr-key\"'));\n  });\n});""",
    """test('root and token-derived Configure routes serve the TV page without exposing secrets', async () => {\n  process.env['CONFIG_UI_TOKEN'] = 'correct-horse-battery-staple';\n  process.env['CONFIG_UI_ENV_FILE'] = await tempEnv();\n  const cfg = uiConfig();\n  const app = createApp(cfg);\n\n  await withServer(app, async (baseUrl) => {\n    for (const url of [`${baseUrl}/configure`, `${addonUrl(baseUrl, cfg)}/configure`]) {\n      const response = await ORIGINAL_FETCH(url);\n      const html = await response.text();\n      assert.equal(response.status, 200);\n      assert.match(response.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/);\n      assert.match(html, /Arr Status &amp; Add/);\n      assert.match(html, /Unlock configuration/);\n      assert.match(html, /\\/assets\\/configure\\.js/);\n      assert.ok(!html.includes('value=\"radarr-key\"'));\n      assert.ok(!html.includes('value=\"sonarr-key\"'));\n    }\n    const wrongToken = await ORIGINAL_FETCH(`${baseUrl}/wrong-token/configure`);\n    assert.equal(wrongToken.status, 404);\n  });\n});""",
)
replace_once(
    "test/config-ui.test.ts",
    """    const payload = current.config;\n    payload.radarr.enabled = true;""",
    """    const payload = current.config;\n    payload.catalog.pageSize = 24;\n    payload.radarr.enabled = true;""",
)
replace_once(
    "test/config-ui.test.ts",
    """    assert.match(saved, /PUBLIC_BASE_URL=https:\\/\\/example\\.invalid/);""",
    """    assert.match(saved, /PUBLIC_BASE_URL=https:\\/\\/example\\.invalid/);\n    assert.match(saved, /CATALOG_PAGE_SIZE=24/);""",
)

config_tests = read("test/config.test.ts")
if "catalogue page size defaults to 30" not in config_tests:
    config_tests += textwrap.dedent(
        """

        test('catalogue page size defaults to 30 and accepts a smaller configured page', () => {
          delete process.env.CATALOG_PAGE_SIZE;
          assert.equal(loadConfig().catalogPageSize, 30);
          process.env.CATALOG_PAGE_SIZE = '24';
          assert.equal(loadConfig().catalogPageSize, 24);
        });

        test('catalogue page size rejects values outside 10 to 100', () => {
          process.env.CATALOG_PAGE_SIZE = '9';
          assert.throws(() => loadConfig(), /CATALOG_PAGE_SIZE/);
          process.env.CATALOG_PAGE_SIZE = '101';
          assert.throws(() => loadConfig(), /CATALOG_PAGE_SIZE/);
        });

        test('short add-on access tokens are accepted while three-character tokens are rejected', () => {
          process.env.ADDON_ACCESS_TOKEN = 'a1B2_c3D';
          assert.equal(loadConfig().addonAccessToken, 'a1B2_c3D');
          process.env.ADDON_ACCESS_TOKEN = 'abc';
          assert.throws(() => loadConfig(), /ADDON_ACCESS_TOKEN must be 4-128/);
        });
        """
    )
write("test/config.test.ts", config_tests)

write(
    "test/configure-assets.test.ts",
    textwrap.dedent(
        """\
        import test from 'node:test';
        import assert from 'node:assert/strict';
        import { readFileSync } from 'node:fs';

        const script = readFileSync(new URL('../assets/configure.js', import.meta.url), 'utf8');
        const css = readFileSync(new URL('../assets/configure.css', import.meta.url), 'utf8');

        test('configuration UI assets contain TV navigation and compact responsive layout safeguards', () => {
          assert.match(script, /FIELD_HELP/);
          assert.match(script, /data\.tvLast/);
          assert.match(script, /active\.type === 'number'/);
          assert.match(script, /BrowserBack/);
          assert.match(script, /switchTab/);
          assert.match(css, /--button: #3b2367/);
          assert.match(css, /grid-template-columns: repeat\(2/);
          assert.match(css, /status-card\[data-state="online"\]/);
        });
        """
    ),
)

print("Applied comprehensive stremio-addarr install/configuration update.")
