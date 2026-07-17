from __future__ import annotations

from pathlib import Path
import subprocess
import traceback

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/fix-install-config-ui-flow"
DIAGNOSTIC = ROOT / ".automation/ci-error.txt"
COMMANDS = [
    ["npm", "run", "typecheck"],
    ["npm", "run", "test:ci"],
    ["npm", "run", "build"],
    ["npm", "run", "lint:manifest"],
]

DIAGNOSTIC.unlink(missing_ok=True)
log: list[str] = []
try:
    for command in COMMANDS:
        label = " ".join(command)
        log.append(f"\n===== {label} =====\n")
        process = subprocess.run(
            command,
            cwd=ROOT,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
        )
        log.append(process.stdout)
        print(process.stdout, end="")
        if process.returncode != 0:
            raise RuntimeError(f"{label} exited with status {process.returncode}")
except BaseException:
    log.append("\n===== EXCEPTION =====\n")
    log.append(traceback.format_exc())
    DIAGNOSTIC.write_text("".join(log), encoding="utf-8")
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=False)
    subprocess.run(
        ["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"],
        cwd=ROOT,
        check=False,
    )
    subprocess.run(["git", "add", str(DIAGNOSTIC.relative_to(ROOT))], cwd=ROOT, check=False)
    subprocess.run(["git", "commit", "-m", "chore: record validation failure"], cwd=ROOT, check=False)
    subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=False)
    raise
