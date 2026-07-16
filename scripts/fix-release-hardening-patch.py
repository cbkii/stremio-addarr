from pathlib import Path

p = Path('scripts/release-hardening-apply.mjs')
s = p.read_text()

source = """`        return [{ name: '🛑❌\\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()) }];`"""
target = """`        return [{ name: '🛑❌\\nSonarr DOWN', description: desc(watchedLine(watched, borderFallback), '🛑  Sonarr not reachable', '🗯️ 🔧  CHECK SETTINGS / NETWORK', this.sonarrCardLine()), url: this.buildStatusStreamUrl(parsed), behaviorHints: { notWebReady: true } }];`"""
old = f"""replaceAllExact('src/services/status.ts',
{source},
{target}, 2);"""
new = f"""replaceAllExact('src/services/status.ts',
{source},
{target}, 1);
replaceOnce('src/services/status.ts',
{source},
{target});"""
if s.count(old) != 1:
    raise SystemExit(f'Expected one Sonarr offline replacement block, found {s.count(old)}')
p.write_text(s.replace(old, new, 1))
