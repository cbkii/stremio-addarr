from __future__ import annotations

from pathlib import Path
import runpy
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
SCRIPT = ROOT / ".automation/final_hardening.py"
DIAGNOSTIC = ROOT / ".automation/final-hardening-error.txt"

DIAGNOSTIC.unlink(missing_ok=True)
try:
    runpy.run_path(str(SCRIPT), run_name="__main__")
except BaseException:
    DIAGNOSTIC.write_text(traceback.format_exc(), encoding="utf-8")
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=False)
    subprocess.run(
        ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
        cwd=ROOT,
        check=False,
    )
    subprocess.run(["git", "add", str(DIAGNOSTIC.relative_to(ROOT))], cwd=ROOT, check=False)
    subprocess.run(["git", "commit", "-m", "chore: record final hardening failure"], cwd=ROOT, check=False)
    subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=False)
    raise
