from __future__ import annotations

from pathlib import Path
import runpy
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
SCRIPT = ROOT / ".automation/apply_comprehensive_update.py"
DIAGNOSTIC = ROOT / ".automation/transform-error.txt"

# Normalise asserted source snippets whose indentation differs from the semantic
# content expected by the transformation, and correct one literal asset-test
# assertion to match `element.dataset.tvLast`.
source = SCRIPT.read_text(encoding="utf-8")
source = source.replace(
    '"""    say \\"Please review app config before continuing.\\"""',
    '"""  say \\"Please review app config before continuing.\\"""',
).replace(
    '"""    configure_tokens\\n\\n    say \\"Please review app config before continuing.\\"""',
    '"""  configure_tokens\\n\\n  say \\"Please review app config before continuing.\\"""',
).replace(
    '"    \'README_HOST.md\',\\n    \'docs/CONFIGURATION_UI.md\',"',
    '"  \'README_HOST.md\',\\n  \'docs/CONFIGURATION_UI.md\',"',
).replace(
    '"    \'README_HOST.md\',\\n    \'CHANGELOG.md\',\\n    \'docs/CONFIGURATION_UI.md\',"',
    '"  \'README_HOST.md\',\\n  \'CHANGELOG.md\',\\n  \'docs/CONFIGURATION_UI.md\',"',
).replace(
    "assert.match(script, /data\\\\.tvLast/);",
    "assert.match(script, /dataset\\\\.tvLast/);",
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
