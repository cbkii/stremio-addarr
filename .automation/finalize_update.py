from __future__ import annotations

import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[1]
package_path = root / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"].pop("preci", None)
package["scripts"].pop("postci", None)
package["scripts"]["ci"] = "npm run typecheck && npm run test:ci && npm run build && npm run lint:manifest"
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

for relative in [
    ".automation/apply_comprehensive_update.py",
    ".automation/run_transform.py",
    ".automation/run_ci.py",
    ".automation/transform-error.txt",
    ".automation/ci-error.txt",
    ".automation/finalize_update.py",
    ".github/workflows/apply-comprehensive-update.yml",
]:
    (root / relative).unlink(missing_ok=True)
try:
    (root / ".automation").rmdir()
except OSError:
    pass

subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=root, check=True)
subprocess.run(
    ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    cwd=root,
    check=True,
)
subprocess.run(["git", "add", "-A"], cwd=root, check=True)
if subprocess.run(["git", "diff", "--cached", "--quiet"], cwd=root).returncode == 0:
    raise SystemExit("No validated implementation changes were produced.")
subprocess.run(
    ["git", "commit", "-m", "fix: harden install flow and redesign configuration UI"],
    cwd=root,
    check=True,
)
branch = "agent/fix-install-config-ui-flow"
subprocess.run(["git", "push", "origin", f"HEAD:{branch}"], cwd=root, check=True)
print(f"Validated implementation committed and pushed to {branch}.")
