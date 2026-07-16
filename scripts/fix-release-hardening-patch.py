from pathlib import Path

p = Path('scripts/release-hardening-apply.mjs')
s = p.read_text()
marker = "replaceAllExact('src/services/status.ts',\n`        return [{ name: '🛑❌"
start = s.index(marker, s.index('Sonarr DOWN') - 100)
end = s.index('// Bound the in-process action queue', start)
block = s[start:end]
if 'Sonarr DOWN' not in block or not block.rstrip().endswith(', 2);'):
    raise SystemExit('Unexpected Sonarr offline replacement block')
s = s[:start] + block.replace(', 2);', ', 1);', 1) + s[end:]
old = "pkg.devDependencies['stremio-addon-linter'] = '^1.9.0';"
new = "pkg.devDependencies['stremio-addon-linter'] = 'github:Stremio/stremio-addon-linter#b791ab42c7ea3781829fe95ed3553bf2b902c3be';"
if s.count(old) != 1:
    raise SystemExit(f'Expected one linter dependency assignment, found {s.count(old)}')
p.write_text(s.replace(old, new, 1))
