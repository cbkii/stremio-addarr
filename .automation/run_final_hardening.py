from __future__ import annotations

from pathlib import Path
import runpy
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
SCRIPT = ROOT / ".automation/final_hardening.py"
DIAGNOSTIC = ROOT / ".automation/final-hardening-error.txt"

source = SCRIPT.read_text(encoding="utf-8")
source = source.replace(
    '"Add an interactive token wizard to `quick.sh`: keep an existing token, specify an 8-character value, or generate a random 8-character value.",',
    '"Add an interactive token wizard to `quick.sh`: keep an existing token, specify a 8-character value, or generate a random 8-character value.",',
)
source = source.replace(
    '''replace_once(
    "src/addon.ts",
    "{ name: 'skip', isRequired: false }",
    "{ name: 'skip', options: catalogSkipOptions, isRequired: false }",
)''',
    '''replace_once(
    "src/addon.ts",
    """          { name: 'filter', options: ['unwatched', 'recent'], isRequired: false },
          { name: 'skip', isRequired: false }""",
    """          { name: 'filter', options: ['unwatched', 'recent'], isRequired: false },
          { name: 'skip', options: catalogSkipOptions, isRequired: false }""",
)''',
)
source = source.replace(
    "# Manifest regression: configured 30-card pages advertise 30-based skip steps.",
    '''# Manifest regression: configured 30-card pages advertise 30-based skip steps.
replace_once(
    "test/addon.test.ts",
    """test('manifest endpoint shape sanity', async () => {
  const cfg = baseConfig();
  const app = createApp(cfg);""",
    """test('manifest endpoint shape sanity', async () => {
  const cfg = baseConfig();
  cfg.catalogPageSize = 30;
  const app = createApp(cfg);""",
)''',
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
    subprocess.run(["git", "commit", "-m", "chore: record final hardening failure"], cwd=ROOT, check=False)
    subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=False)
    raise
