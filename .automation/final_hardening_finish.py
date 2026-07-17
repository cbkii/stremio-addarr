from __future__ import annotations

import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
package_path = ROOT / "package.json"
package = json.loads(package_path.read_text(encoding="utf-8"))
package["scripts"].pop("preci", None)
package["scripts"].pop("postci", None)
package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")

for relative in [".automation/final_hardening.py", ".automation/final_hardening_finish.py"]:
    (ROOT / relative).unlink(missing_ok=True)
try:
    (ROOT / ".automation").rmdir()
except OSError:
    pass

subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=True)
subprocess.run(
    ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
    cwd=ROOT,
    check=True,
)
subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
subprocess.run(
    ["git", "commit", "-m", "fix: preserve compact catalogue pagination and harden short tokens"],
    cwd=ROOT,
    check=True,
)
subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=True)
