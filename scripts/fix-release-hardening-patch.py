from pathlib import Path

p = Path('scripts/release-hardening-apply.mjs')
s = p.read_text()
marker = "replaceAllExact('src/services/status.ts',\n`        return [{ name: '🛑❌"
start = s.index(marker, s.index('Sonarr DOWN') - 100)
end = s.index('// Bound the in-process action queue', start)
block = s[start:end]
if 'Sonarr DOWN' not in block or not block.rstrip().endswith(', 2);'):
    raise SystemExit('Unexpected Sonarr offline replacement block')
p.write_text(s[:start] + block.replace(', 2);', ', 1);', 1) + s[end:])
