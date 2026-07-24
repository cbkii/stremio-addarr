from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file_path = Path(path)
    content = file_path.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one occurrence, found {count}')
    file_path.write_text(content.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/services/radarr.ts',
    "      const existingSummary = existing.hasFile || existing.movieFile\n        ? 'Movie is already downloaded.'\n        : 'Movie is already added.';\n      return {\n        ok: true,\n        service: 'radarr',\n        title: 'Already in Radarr',\n        summary: profile ? `${existingSummary} Existing profile: ${profile}.` : existingSummary,\n        detail: existing.title,\n        alreadyExisted: true,\n        itemId: existing.id\n      };",
    "      return {\n        ok: true,\n        service: 'radarr',\n        title: 'Already in Radarr',\n        summary: existing.hasFile || existing.movieFile ? 'Movie is already downloaded.' : 'Movie is already added.',\n        detail: `${existing.title}${profile ? ` · ${profile}` : ''}`,\n        alreadyExisted: true,\n        itemId: existing.id\n      };",
)
replace_once(
    'src/services/status.ts',
    "        knownMovieId: added.itemId,\n        knownTitle: added.detail\n      })",
    "        knownMovieId: added.itemId,\n        knownTitle: added.detail?.split(' · ', 1)[0]\n      })",
)
print('Radarr title hand-off fixed without changing the public action result.')
