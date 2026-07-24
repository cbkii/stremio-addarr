from __future__ import annotations

import json
import runpy
from pathlib import Path

config_path = Path('src/config.ts')
if 'export type ExistingItemPolicy' not in config_path.read_text(encoding='utf-8'):
    print('Existing-item implementation is not applied yet; migration wrapper skipped.')
    raise SystemExit(0)

helper_path = Path('scripts/update-existing-item-policy-tests.py')
helper = helper_path.read_text(encoding='utf-8')
replacements = {
    'assert.equal(payload.addOptions.searchForMissingEpisodes, true);':
        'assert.equal(addOptions.searchForMissingEpisodes, true);',
    'assert.equal(payload.addOptions.searchForMissingEpisodes, false);':
        'assert.equal(addOptions.searchForMissingEpisodes, false);',
}
for old, new in replacements.items():
    if helper.count(old) != 1:
        raise SystemExit(f'expected exactly one stale Sonarr addOptions assertion, found {helper.count(old)}: {old}')
    helper = helper.replace(old, new, 1)
helper_path.write_text(helper, encoding='utf-8')

package_path = Path('package.json')
package = json.loads(package_path.read_text(encoding='utf-8'))
expected_wrapper = 'python3 scripts/run-existing-item-policy-migration.py'
if package.get('scripts', {}).get('preci') != expected_wrapper:
    raise SystemExit('package.json: migration wrapper hook is missing or unexpected')
package['scripts']['preci'] = 'python3 scripts/update-existing-item-policy-tests.py'
package_path.write_text(json.dumps(package, indent=2) + '\n', encoding='utf-8')

Path(__file__).unlink()
runpy.run_path(str(helper_path), run_name='__main__')
