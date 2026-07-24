#!/usr/bin/env bash
set -uo pipefail

log_file="${RUNNER_TEMP:-/tmp}/existing-item-policy-ci.log"
set +e
{
  npm run typecheck && \
  npm test && \
  npm run build && \
  npm run lint:manifest
} 2>&1 | tee "$log_file"
status=${PIPESTATUS[0]}
set -e

if [[ "$status" != "0" ]]; then
  {
    echo 'Existing-item policy implementation validation failed.'
    echo
    tail -n 500 "$log_file"
  } > validation-error.txt
  exit "$status"
fi

# Restore the canonical script definition and delete this temporary wrapper.
python3 - <<'PY'
from pathlib import Path
import json

package_path = Path('package.json')
package = json.loads(package_path.read_text())
scripts = package['scripts']
if scripts.get('ci') != 'bash scripts/ci-existing-item-policy.sh':
    raise SystemExit('package.json: temporary ci wrapper is missing or unexpected')
scripts['ci'] = 'npm run typecheck && npm test && npm run build && npm run lint:manifest'
package_path.write_text(json.dumps(package, indent=2) + '\n')
Path('scripts/ci-existing-item-policy.sh').unlink()
PY
