from __future__ import annotations

from pathlib import Path
import runpy
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
SCRIPT = ROOT / ".automation/apply_comprehensive_update.py"
DIAGNOSTIC = ROOT / ".automation/transform-error.txt"

# Correct the asserted indentation used by the install-mode insertion. The
# source line is inside a two-space shell block; upgrade-mode gates use four.
source = SCRIPT.read_text(encoding="utf-8")
source = source.replace(
    '"""    say \\"Please review app config before continuing.\\"""',
    '"""  say \\"Please review app config before continuing.\\"""',
).replace(
    '"""    configure_tokens\\n\\n    say \\"Please review app config before continuing.\\"""',
    '"""  configure_tokens\\n\\n  say \\"Please review app config before continuing.\\"""',
)
SCRIPT.write_text(source, encoding="utf-8")
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
    subprocess.run(["git", "commit", "-m", "chore: record transformation failure"], cwd=ROOT, check=False)
    subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=False)
    raise
