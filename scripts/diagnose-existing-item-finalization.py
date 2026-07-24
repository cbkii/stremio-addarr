from __future__ import annotations

import json
import subprocess
from pathlib import Path

SOURCE_MARKER = 'itemId?: number;'
source_path = Path('src/types.ts')
if SOURCE_MARKER not in source_path.read_text(encoding='utf-8'):
    print('Final hardening is not applied in this workspace; diagnostic validation skipped.')
    raise SystemExit(0)

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
scripts = package.get('scripts', {})
expected = 'python3 scripts/diagnose-existing-item-finalization.py'
if scripts.get('preci') != expected:
    raise SystemExit('package.json: finalization diagnostic hook is missing or unexpected')
del scripts['preci']
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')
Path(__file__).unlink()

commands = [
    ['npm', 'run', 'typecheck'],
    ['npm', 'test'],
    ['npm', 'run', 'build'],
    ['npm', 'run', 'lint:manifest'],
]
output: list[str] = []
for command in commands:
    completed = subprocess.run(command, text=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    output.extend(completed.stdout.splitlines())
    if completed.returncode != 0:
        heading = f"Finalization validation failed: {' '.join(command)}"
        diagnostic = heading + '\n\n' + '\n'.join(output[-240:]) + '\n'
        print(heading)

        # Publish only the diagnostic. Restore the branch checkout first so none
        # of the unvalidated hardening transformation can leak into the branch.
        subprocess.run(['git', 'reset', '--hard', 'HEAD'], check=True)
        diagnostic_path = Path('finalization-diagnostic.txt')
        diagnostic_path.write_text(diagnostic, encoding='utf-8')
        subprocess.run(['git', 'config', 'user.name', 'github-actions[bot]'], check=True)
        subprocess.run(['git', 'config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com'], check=True)
        subprocess.run(['git', 'add', 'finalization-diagnostic.txt'], check=True)
        subprocess.run(['git', 'commit', '-m', 'chore: capture finalization failure [skip ci]'], check=True)
        subprocess.run(['git', 'push', 'origin', 'HEAD:agent/preserve-existing-arr-settings'], check=True)
        raise SystemExit(completed.returncode)

print('Finalization diagnostic validation passed; continuing with canonical CI.')
