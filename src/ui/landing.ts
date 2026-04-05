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
      code, pre { background: #0f172a; border-radius: 8px; padding: 4px 8px; font-size: 0.9em; word-break: break-all; display: block; margin: 6px 0; }
      a { color: #93c5fd; }
      h1, h2 { margin-top: 0; }
      .ok { color: #86efac; }
      .warn { color: #fcd34d; }
      .bad { color: #fca5a5; }
      .btn {
        display: inline-block;
        background: #2563eb;
        color: #fff;
        border-radius: 12px;
        padding: 14px 28px;
        font-size: 1.1em;
        font-weight: bold;
        text-decoration: none;
        margin: 8px 8px 8px 0;
        cursor: pointer;
      }
      .btn:hover { background: #1d4ed8; }
      .btn.secondary { background: #374151; }
      .btn.secondary:hover { background: #4b5563; }
      .btn.big { font-size: 1.3em; padding: 18px 36px; width: 100%; box-sizing: border-box; text-align: center; display: block; }
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
  const qrUrl = `https://chart.googleapis.com/chart?cht=qr&chs=200x200&chl=${encodeURIComponent(installUrl)}`;

  const radarrStatus = config.radarr.enabled
    ? '<span class="ok">enabled</span>'
    : '<span class="warn">disabled</span>';
  const sonarrStatus = config.sonarr.enabled
    ? '<span class="ok">enabled</span>'
    : '<span class="warn">disabled</span>';

  const urlWarnings = config.publicUrlValidation.warnings.length > 0
    ? `<section class="card">
      <h2 class="warn">⚠ Configuration Warnings</h2>
      <ul>${config.publicUrlValidation.warnings.map((w) => `<li class="warn">${escapeHtml(w)}</li>`).join('')}</ul>
    </section>`
    : '';

  return shell(
    'stremio-addarr',
    `
    <h1>stremio-addarr</h1>
    <p>Self-hosted Arr Status &amp; Add for Stremio. Raspberry Pi + LAN-first.</p>

    ${urlWarnings}

    <section class="card">
      <h2>Install in Stremio</h2>
      <p>Manifest URL (paste into Stremio → Add Addon):</p>
      <code>${escapeHtml(manifestUrl)}</code>
      <p>Or click the button below on a device with Stremio installed:</p>
      <a class="btn big" href="${escapeHtml(installUrl)}">📺 Install in Stremio</a>
      <p style="margin-top:16px;font-size:0.9em">Scan on your Android TV or phone:</p>
      <img src="${escapeHtml(qrUrl)}" alt="QR code for Stremio install URL" width="200" height="200" style="border-radius:8px" />
    </section>

    <section class="card">
      <h2>Status</h2>
      <ul>
        <li>Radarr: ${radarrStatus}</li>
        <li>Sonarr: ${sonarrStatus}</li>
      </ul>
      <p>
        <a href="/healthz">Liveness (/healthz)</a> &nbsp;|&nbsp;
        <a href="/status.json">Diagnostics (/status.json)</a>
      </p>
    </section>

    <section class="card">
      <h2>Deployment</h2>
      <p>Running on a Raspberry Pi? See <code>stremio-addarr.service</code> for a systemd example and <code>Caddyfile.example</code> for LAN HTTPS with Caddy.</p>
      <p>Stremio clients on Android TV and other remote devices require HTTPS. Set <code>PUBLIC_BASE_URL</code> to your Caddy-exposed HTTPS address.</p>
    </section>
  `
  );
}

export function renderActionResultPage(result: AddActionResult, returnUrl: string): string {
  const statusClass = result.ok ? 'ok' : 'bad';
  const icon = result.ok ? '✅' : '❌';
  return shell(
    result.title,
    `
    <section class="card">
      <h1 class="${statusClass}">${icon} ${escapeHtml(result.title)}</h1>
      <p style="font-size:1.1em">${escapeHtml(result.summary)}</p>
      ${result.detail ? `<p>${escapeHtml(result.detail)}</p>` : ''}
      <div style="margin-top:24px">
        <a class="btn big" href="${escapeHtml(returnUrl)}">▶ Return to Stremio</a>
        <a class="btn secondary" href="/" style="margin-top:8px;display:block;text-align:center">Add-on home</a>
      </div>
    </section>
  `
  );
}
