function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function renderStremioBouncePage(returnUrl: string, message: string): string {
  const safeReturnUrl = escapeHtml(returnUrl);
  const safeMessage = escapeHtml(message);
  return (
    '<!doctype html><html><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    `<meta http-equiv="refresh" content="0;url=${safeReturnUrl}">` +
    `<title>${safeMessage}</title>` +
    '</head><body>' +
    `<p>${safeMessage}</p>` +
    `<p><a href="${safeReturnUrl}">Return to Stremio</a></p>` +
    `<script>window.location.replace(${JSON.stringify(returnUrl)});</script>` +
    '</body></html>'
  );
}
