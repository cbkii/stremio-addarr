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
  if [[ -n "${GH_TOKEN:-}" ]] && command -v gh >/dev/null 2>&1; then
    current_body="$(gh pr view 76 --repo cbkii/stremio-addarr --json body --jq .body)"
    CURRENT_BODY="$current_body" LOG_FILE="$log_file" python3 - <<'PY'
from pathlib import Path
import os

start = '<!-- existing-item-validation-start -->'
end = '<!-- existing-item-validation-end -->'
body = os.environ['CURRENT_BODY']
if start in body and end in body:
    before, remainder = body.split(start, 1)
    _, after = remainder.split(end, 1)
    body = before.rstrip() + '\n\n' + after.lstrip()
lines = Path(os.environ['LOG_FILE']).read_text(errors='replace').splitlines()[-220:]
diagnostic = (
    f"{start}\n"
    "## Current implementation validation failure\n\n"
    "```text\n"
    + '\n'.join(lines)
    + f"\n```\n{end}"
)
Path('/tmp/pr-76-body.md').write_text(body.rstrip() + '\n\n' + diagnostic + '\n')
PY
    gh pr edit 76 --repo cbkii/stremio-addarr --body-file /tmp/pr-76-body.md || true
  fi
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
