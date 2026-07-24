from pathlib import Path
import subprocess

GREEN_COMMIT = '1f2198762254dc5e851dda1984e59a80a3d0939e'


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


subprocess.run(
    ['git', 'checkout', GREEN_COMMIT, '--', 'src/services/radarr.ts'],
    check=True,
)
replace_once(
    'src/services/status.ts',
    "        knownMovieId: added.itemId,\n        knownTitle: added.detail\n      })",
    "        knownMovieId: added.itemId,\n        knownTitle: added.detail?.split(' · ', 1)[0]\n      })",
)
print('Restored the last green Radarr implementation and fixed only its title hand-off.')
