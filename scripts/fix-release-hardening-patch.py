from pathlib import Path

p = Path('scripts/release-hardening-apply.mjs')
s = p.read_text()

needle = """function replaceRegex(file, re, to, expected = 1) {"""
helper = """function replaceAllExact(file, from, to, expected) {
  const input = read(file);
  const count = input.split(from).length - 1;
  if (count !== expected) throw new Error(`${file}: expected ${expected} exact matches, found ${count}: ${from.slice(0, 120)}`);
  write(file, input.split(from).join(to));
}
"""
if helper not in s:
    s = s.replace(needle, helper + needle, 1)

block = r"""replaceOnce('src/services/status.ts',
`            fileUrl ? '🗯️ ▶️  PLAY FROM PI ►' : (kodiExternalUrl ? '🗯️ ▶️  OPEN IN KODI ►' : '🗯️ ▶️  PLAY FROM PI ►')`,
`            fileUrl ? '🗯️ ▶️  PLAY FROM PI ►' : (kodiExternalUrl ? '🗯️ ▶️  OPEN IN KODI ►' : '🗯️ Playback unavailable — enable direct streaming or Kodi')`);"""
replacement = block.replace('replaceOnce', 'replaceAllExact').replace('`);', '`, 2);')
assert s.count(block) == 2, s.count(block)
s = s.replace(block, replacement, 1)
s = s.replace(block, '', 1)

block = r"""replaceOnce('src/services/status.ts',
`          url: fileUrl,
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : undefined,
          externalUrl: kodiExternalUrl`,
`          url: fileUrl ?? (kodiExternalUrl ? undefined : this.buildStatusStreamUrl(parsed)),
          behaviorHints: fileUrl ? {
            notWebReady: true,
            filename: status.fileName,
            videoSize: status.fileSizeBytes
          } : (kodiExternalUrl ? undefined : { notWebReady: true }),
          externalUrl: kodiExternalUrl`, 1);"""
replacement = block.replace('replaceOnce', 'replaceAllExact').replace(', 1);', ', 2);')
assert s.count(block) == 2, s.count(block)
s = s.replace(block, replacement, 1)
s = s.replace(block, '', 1)

for service, line_method in [('Radarr', 'radarrCardLine'), ('Sonarr', 'sonarrCardLine')]:
    block = f"""replaceOnce('src/services/status.ts',
`        return [{{ name: '🛑❌\\n{service} DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  {service} not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.{line_method}()) }}];`,
`        return [{{ name: '🛑❌\\n{service} DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  {service} not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.{line_method}()), url: this.buildStatusStreamUrl(parsed), behaviorHints: {{ notWebReady: true }} }}];`);"""
    assert s.count(block) == 1, (service, s.count(block))
    s = s.replace(block, block.replace('replaceOnce', 'replaceAllExact').replace('`);', '`, 2);'), 1)

start = s.index('// Two early service-health returns use the same source-less shape.')
end = s.index('// Bound the in-process action queue', start)
s = s[:start] + s[end:]

block = r"""replaceOnce('src/index.ts',
`      manifest: \`\${config.publicBaseUrl}/manifest.json\`,`,
`      manifest: \`\${config.publicBaseUrl}/<protected>/manifest.json\`,`);"""
assert s.count(block) == 1, s.count(block)
s = s.replace(block, block.replace('replaceOnce', 'replaceAllExact').replace('`);', '`, 2);'), 1)

block = r"""replaceOnce('src/index.ts',
`      manifest: \`\${config.publicBaseUrl}/manifest.json\`,
      configure: \`\${config.publicBaseUrl}/configure\``,
`      manifest: \`\${config.publicBaseUrl}/<protected>/manifest.json\`,
      configure: config.configUiEnabled ? \`\${config.publicBaseUrl}/configure\` : 'disabled'`);"""
assert s.count(block) == 1, s.count(block)
s = s.replace(block, r"""replaceOnce('src/index.ts',
`      configure: \`\${config.publicBaseUrl}/configure\``,
`      configure: config.configUiEnabled ? \`\${config.publicBaseUrl}/configure\` : 'disabled'`);""", 1)

block = r"""replaceOnce('src/config-ui-core.ts',
`      manifestUrl: \`\${config.publicBaseUrl.replace(/\\/+$/, '')}/manifest.json\`,
      stremioUrl: stremioManifestUrl(config.publicBaseUrl),`,
`      manifestUrl: addonManifestUrl(config),
      stremioUrl: stremioInstallUrl(config),`);"""
assert s.count(block) == 1, s.count(block)
s = s.replace(block, block.replace('replaceOnce', 'replaceAllExact').replace('`);', '`, 2);'), 1)

block = r"""replaceOnce('src/config-ui-core.ts',
`      manifestUrl: \`\${config.publicBaseUrl.replace(/\\/+$/, '')}/manifest.json\`,
      stremioUrl: stremioManifestUrl(config.publicBaseUrl)`,
`      manifestUrl: addonManifestUrl(config),
      stremioUrl: stremioInstallUrl(config)`);"""
assert s.count(block) == 1, s.count(block)
s = s.replace(block, '', 1)

old = "replaceRegex('docker-compose.example.yml', /- \\.\\/\\.env:\\/app\\/\\.env/g, `- ./.env:/app/config/.env` , 1);"
assert s.count(old) == 1, s.count(old)
s = s.replace(old, """replaceOnce('docker-compose.example.yml', '      CONFIG_UI_ENV_FILE: \"/app/.env\"', '      CONFIG_UI_ENV_FILE: \"/app/config/.env\"');
replaceOnce('docker-compose.example.yml', '      - ./.env:/app/.env', '      - ./config/.env:/app/config/.env');""", 1)

p.write_text(s)
