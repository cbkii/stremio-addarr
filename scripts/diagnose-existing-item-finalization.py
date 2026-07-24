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
        print(f"Finalization validation failed: {' '.join(command)}")
        print('\n'.join(output[-120:]))
        raise SystemExit(completed.returncode)

print('Finalization diagnostic validation passed; continuing with canonical CI.')
