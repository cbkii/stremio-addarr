from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BRANCH = "agent/replace-checkboxes-with-dropdowns"


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding="utf-8")


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding="utf-8")


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected one match, found {count}: {old!r}")
    write(path, content.replace(old, new, 1))


def apply() -> None:
    boolean_controls = {
        '<div class="toggle-row"><label for="radarr-enabled">Enable Radarr</label><input id="radarr-enabled" type="checkbox"></div>': '<label for="radarr-enabled">Radarr integration</label><select id="radarr-enabled" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="radarr-search">Search immediately after add</label><input id="radarr-search" type="checkbox"></div>': '<label for="radarr-search">Search immediately after add</label><select id="radarr-search" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="radarr-strict">Require strict IMDb match</label><input id="radarr-strict" type="checkbox"></div>': '<label for="radarr-strict">Require strict IMDb match</label><select id="radarr-strict" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="sonarr-enabled">Enable Sonarr</label><input id="sonarr-enabled" type="checkbox"></div>': '<label for="sonarr-enabled">Sonarr integration</label><select id="sonarr-enabled" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="sonarr-search">Search immediately after add</label><input id="sonarr-search" type="checkbox"></div>': '<label for="sonarr-search">Search immediately after add</label><select id="sonarr-search" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="kodi-enabled">Enable Kodi fallback</label><input id="kodi-enabled" type="checkbox"></div>': '<label for="kodi-enabled">Kodi fallback</label><select id="kodi-enabled" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="streaming-enabled">Enable direct Pi file streaming</label><input id="streaming-enabled" type="checkbox"></div>': '<label for="streaming-enabled">Direct Pi file streaming</label><select id="streaming-enabled" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
        '<div class="toggle-row"><label for="trakt-enabled">Enable Trakt sync</label><input id="trakt-enabled" type="checkbox"></div>': '<label for="trakt-enabled">Trakt watched sync</label><select id="trakt-enabled" data-boolean-select="true"><option value="true">Enabled</option><option value="false">Disabled</option></select>',
    }
    for old, new in boolean_controls.items():
        replace_once("src/config-ui-core.ts", old, new)

    replace_once(
        "assets/configure.js",
        "function selectValue(id, value, fallbackLabel) {\n  const select = byId(id);\n  option(select, value ?? '', fallbackLabel || String(value ?? ''));\n  select.value = String(value ?? '');\n}\n",
        "function selectValue(id, value, fallbackLabel) {\n  const select = byId(id);\n  option(select, value ?? '', fallbackLabel || String(value ?? ''));\n  select.value = String(value ?? '');\n}\n\nfunction setBooleanValue(id, value) {\n  byId(id).value = value ? 'true' : 'false';\n}\n\nfunction readBooleanValue(id) {\n  const value = byId(id).value;\n  if (value !== 'true' && value !== 'false') {\n    throw new Error(`Invalid boolean selection for ${id}.`);\n  }\n  return value === 'true';\n}\n",
    )

    assignments = {
        "byId('radarr-enabled').checked = radarr.enabled;": "setBooleanValue('radarr-enabled', radarr.enabled);",
        "byId('radarr-search').checked = radarr.searchOnAdd;": "setBooleanValue('radarr-search', radarr.searchOnAdd);",
        "byId('radarr-strict').checked = radarr.strictImdbMatch;": "setBooleanValue('radarr-strict', radarr.strictImdbMatch);",
        "byId('sonarr-enabled').checked = sonarr.enabled;": "setBooleanValue('sonarr-enabled', sonarr.enabled);",
        "byId('sonarr-search').checked = sonarr.searchOnAdd;": "setBooleanValue('sonarr-search', sonarr.searchOnAdd);",
        "byId('kodi-enabled').checked = playback.kodiEnabled;": "setBooleanValue('kodi-enabled', playback.kodiEnabled);",
        "byId('streaming-enabled').checked = playback.fileStreamingEnabled;": "setBooleanValue('streaming-enabled', playback.fileStreamingEnabled);",
        "byId('trakt-enabled').checked = trakt.enabled;": "setBooleanValue('trakt-enabled', trakt.enabled);",
        "enabled: byId('radarr-enabled').checked,": "enabled: readBooleanValue('radarr-enabled'),",
        "searchOnAdd: byId('radarr-search').checked,": "searchOnAdd: readBooleanValue('radarr-search'),",
        "strictImdbMatch: byId('radarr-strict').checked": "strictImdbMatch: readBooleanValue('radarr-strict')",
        "enabled: byId('sonarr-enabled').checked,": "enabled: readBooleanValue('sonarr-enabled'),",
        "searchOnAdd: byId('sonarr-search').checked": "searchOnAdd: readBooleanValue('sonarr-search')",
        "kodiEnabled: byId('kodi-enabled').checked,": "kodiEnabled: readBooleanValue('kodi-enabled'),",
        "fileStreamingEnabled: byId('streaming-enabled').checked,": "fileStreamingEnabled: readBooleanValue('streaming-enabled'),",
        "enabled: byId('trakt-enabled').checked,": "enabled: readBooleanValue('trakt-enabled'),",
    }
    for old, new in assignments.items():
        replace_once("assets/configure.js", old, new)

    replace_once(
        "assets/configure.js",
        "const FIELD_HELP = {\n  'radarr-url':",
        "const FIELD_HELP = {\n  'radarr-enabled': 'Choose Enabled to expose Radarr actions and catalogues, or Disabled to leave Radarr unused.',\n  'radarr-search': 'Choose Enabled to start a Radarr search immediately after adding a movie.',\n  'radarr-strict': 'Choose Enabled to require an exact IMDb match before Radarr actions are offered.',\n  'sonarr-enabled': 'Choose Enabled to expose Sonarr actions and catalogues, or Disabled to leave Sonarr unused.',\n  'sonarr-search': 'Choose Enabled to start a Sonarr search immediately after adding a series or episode.',\n  'kodi-enabled': 'Choose Enabled to offer Kodi as a playback fallback.',\n  'streaming-enabled': 'Choose Enabled to serve existing media files directly from this Pi.',\n  'trakt-enabled': 'Choose Enabled to synchronise watched history with Trakt.',\n  'radarr-url':",
    )

    replace_once(
        "test/config-ui.test.ts",
        "      assert.match(html, /\\/assets\\/configure\\.js/);\n      assert.ok(!html.includes('value=\"radarr-key\"'));",
        "      assert.match(html, /\\/assets\\/configure\\.js/);\n      assert.doesNotMatch(html, /type=\"checkbox\"/);\n      assert.equal((html.match(/data-boolean-select=\"true\"/g) ?? []).length, 8);\n      assert.match(html, /id=\"radarr-enabled\"[^>]*><option value=\"true\">Enabled<\\/option><option value=\"false\">Disabled<\\/option>/);\n      assert.ok(!html.includes('value=\"radarr-key\"'));",
    )

    replace_once(
        "test/configure-assets.test.ts",
        "  assert.match(script, /FIELD_HELP/);",
        "  assert.match(script, /FIELD_HELP/);\n  assert.match(script, /setBooleanValue/);\n  assert.match(script, /readBooleanValue/);\n  assert.doesNotMatch(script, /\\.checked\\b/);",
    )

    replace_once(
        "CHANGELOG.md",
        "- Rework D-pad behaviour so form navigation is sequential, number inputs can be exited, tabs are predictable, Back first leaves edit mode, and the sticky save action is reached only at the end.",
        "- Rework D-pad behaviour so form navigation is sequential, number inputs can be exited, tabs are predictable, Back first leaves edit mode, and the sticky save action is reached only at the end.\n- Replace all Configure UI checkboxes with explicit Enabled/Disabled dropdowns for reliable Android TV remote operation.",
    )


def finish() -> None:
    package_path = ROOT / "package.json"
    package = json.loads(package_path.read_text(encoding="utf-8"))
    package["scripts"].pop("pretest:catalog", None)
    package["scripts"].pop("postci", None)
    package_path.write_text(json.dumps(package, indent=2) + "\n", encoding="utf-8")
    (ROOT / ".github/workflows/dropdown-followup.yml").unlink(missing_ok=True)
    Path(__file__).unlink(missing_ok=True)
    subprocess.run(["git", "config", "user.name", "github-actions[bot]"], cwd=ROOT, check=True)
    subprocess.run(["git", "config", "user.email", "41898282+github-actions[bot]@users.noreply.github.com"], cwd=ROOT, check=True)
    subprocess.run(["git", "add", "-A"], cwd=ROOT, check=True)
    subprocess.run(["git", "commit", "-m", "fix(ui): replace checkboxes with boolean dropdowns"], cwd=ROOT, check=True)
    subprocess.run(["git", "push", "origin", f"HEAD:{BRANCH}"], cwd=ROOT, check=True)


if len(sys.argv) != 2 or sys.argv[1] not in {"apply", "finish"}:
    raise SystemExit("usage: replace-checkboxes.py apply|finish")

apply() if sys.argv[1] == "apply" else finish()
