import type { AppConfig } from '../config.js';
import type { AddActionResult } from '../types.js';

function shell(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: dark; }
      body { font-family: system-ui, sans-serif; margin: 0; background: #111827; color: #f9fafb; }
      main { max-width: 720px; margin: 0 auto; padding: 24px; }
      .card { background: #1f2937; border-radius: 16px; padding: 20px; margin: 16px 0; }
      code, pre { background: #0f172a; border-radius: 8px; padding: 2px 6px; }
      a { color: #93c5fd; }
      h1, h2 { margin-top: 0; }
      .ok { color: #86efac; }
      .warn { color: #fcd34d; }
      .bad { color: #fca5a5; }
      .actions a { display: inline-block; margin-right: 12px; margin-top: 8px; }
    </style>
  </head>
  <body>
    <main>${body}</main>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderLandingPage(config: AppConfig): string {
  const manifestUrl = `${config.publicBaseUrl}/manifest.json`;
  const installUrl = manifestUrl.replace(/^https?:\/\//, 'stremio://');

  return shell(
    'stremio-addarr',
    `
    <h1>stremio-addarr</h1>
    <p>Self-hosted Arr Status &amp; Add starter for Stremio.</p>

    <section class="card">
      <h2>Install</h2>
      <p>Manifest URL:</p>
      <pre>${escapeHtml(manifestUrl)}</pre>
      <p>Stremio install URL:</p>
      <pre>${escapeHtml(installUrl)}</pre>
    </section>

    <section class="card">
      <h2>Health</h2>
      <p><a href="/health">Open /health</a></p>
      <ul>
        <li>Radarr: ${config.radarr.enabled ? '<span class="ok">enabled</span>' : '<span class="warn">disabled</span>'}</li>
        <li>Sonarr: ${config.sonarr.enabled ? '<span class="ok">enabled</span>' : '<span class="warn">disabled</span>'}</li>
      </ul>
    </section>

    <section class="card">
      <h2>Notes</h2>
      <p>This starter keeps Arr credentials server-side in <code>.env</code> and is intended for private LAN use. For Stremio clients on other devices, set <code>PUBLIC_BASE_URL</code> to an HTTPS URL.</p>
    </section>
  `
  );
}

export function renderActionResultPage(result: AddActionResult, returnUrl: string): string {
  const statusClass = result.ok ? 'ok' : 'bad';
  return shell(
    result.title,
    `
    <section class="card">
      <h1 class="${statusClass}">${escapeHtml(result.title)}</h1>
      <p>${escapeHtml(result.summary)}</p>
      ${result.detail ? `<p>${escapeHtml(result.detail)}</p>` : ''}
      <div class="actions">
        <a href="${escapeHtml(returnUrl)}">Return to Stremio</a>
        <a href="/">Open add-on home</a>
      </div>
    </section>
  `
  );
}
