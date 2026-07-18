from pathlib import Path
import re
import subprocess


def replace_once(path_name: str, old: str, new: str) -> None:
    path = Path(path_name)
    content = path.read_text()
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path_name}: expected exactly one match, found {count}: {old[:100]!r}')
    path.write_text(content.replace(old, new, 1))


def regex_once(path_name: str, pattern: str, replacement: str, flags: int = 0) -> None:
    path = Path(path_name)
    content = path.read_text()
    content, count = re.subn(pattern, replacement, content, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path_name}: structural pattern did not match exactly once: {pattern[:100]!r}')
    path.write_text(content)


# Restore the complete maintained test file, then apply only the new requirement.
main_test = subprocess.check_output(
    ['git', 'show', 'origin/main:test/config.test.ts'],
    text=True
)
Path('test/config.test.ts').write_text(main_test)
replace_once(
    'test/config.test.ts',
    "  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';\n  process.env.TRAKT_API_BASE_URL = 'https://api.trakt.tv';\n",
    "  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';\n"
    "  process.env.TRAKT_REDIRECT_URI = 'https://example.invalid/trakt/callback';\n"
    "  process.env.TRAKT_API_BASE_URL = 'https://api.trakt.tv';\n"
)
replace_once(
    'test/config.test.ts',
    "  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';\n"
    "  assert.throws(() => loadConfig(), /TRAKT_SYNC_MINS must be at least 40/);\n",
    "  process.env.TRAKT_REFRESH_TOKEN = 'refresh-token';\n"
    "  process.env.TRAKT_REDIRECT_URI = 'https://example.invalid/trakt/callback';\n"
    "  assert.throws(() => loadConfig(), /TRAKT_SYNC_MINS must be at least 40/);\n"
)

# Preserve non-zero helper return codes through Bash conditionals.
regex_once(
    'quick.sh',
    r'''  if ! run_trakt_device_auth; then\n'''
    r'''    local rc=\$\?\n'''
    r'''    if \[\[ "\$rc" -ne 2 \]\]; then\n'''
    r'''      warn "Continuing the install/upgrade without changing Trakt authentication\."\n'''
    r'''    fi\n'''
    r'''  fi\n''',
    '''  if run_trakt_device_auth; then
    return 0
  else
    local rc=$?
    if [[ "$rc" -ne 2 ]]; then
      warn "Continuing the install/upgrade without changing Trakt authentication."
    fi
    return 0
  fi
'''
)
regex_once(
    'quick.sh',
    r'''  if run_trakt_device_auth; then\n'''
    r'''    exit 0\n'''
    r'''  fi\n'''
    r'''  rc=\$\?\n'''
    r'''  \[\[ "\$rc" -eq 2 \]\] && exit 0\n'''
    r'''  exit "\$rc"\n''',
    '''  if run_trakt_device_auth; then
    exit 0
  else
    rc=$?
    [[ "$rc" -eq 2 ]] && exit 0
    exit "$rc"
  fi
'''
)

# Keep the provider's absolute expiry separate from the proactive refresh point.
replace_once(
    'src/services/trakt-watched.ts',
    '  tokenExpiresAt?: number;\n',
    '  tokenExpiresAt?: number;\n  tokenRefreshAt?: number;\n'
)
replace_once(
    'src/services/trakt-watched.ts',
    "  /** Refresh threshold, deliberately before the provider's absolute expiry. */\n"
    "  private tokenExpiresAt: number;\n",
    "  private tokenExpiresAt: number;\n"
    "  /** Refresh threshold, deliberately before the provider's absolute expiry. */\n"
    "  private tokenRefreshAt: number;\n"
)
replace_once(
    'src/services/trakt-watched.ts',
    '    this.userAgent = `stremio-addarr/${config.version}`;\n'
    '    this.tokenExpiresAt = this.initialRefreshThreshold();\n',
    '    this.userAgent = `stremio-addarr/${config.version}`;\n'
    '    const initialTiming = this.initialTokenTiming();\n'
    '    this.tokenExpiresAt = initialTiming.expiresAtMs;\n'
    '    this.tokenRefreshAt = initialTiming.refreshAtMs;\n'
)
regex_once(
    'src/services/trakt-watched.ts',
    r'''  private initialRefreshThreshold\(\): number \{.*?\n  \}\n''',
    '''  private initialTokenTiming(): { expiresAtMs: number; refreshAtMs: number } {
    if (!this.accessToken || this.config.traktSync.accessTokenCreatedAt <= 0
      || this.config.traktSync.accessTokenExpiresIn <= 0) {
      return { expiresAtMs: 0, refreshAtMs: 0 };
    }
    const timing = traktTokenTiming({
      access_token: this.accessToken,
      refresh_token: this.refreshToken,
      created_at: this.config.traktSync.accessTokenCreatedAt,
      expires_in: this.config.traktSync.accessTokenExpiresIn
    }, this.now());
    return { expiresAtMs: timing.expiresAtMs, refreshAtMs: timing.refreshAtMs };
  }
''',
    re.S
)
replace_once(
    'src/services/trakt-watched.ts',
    '      if (!this.accessToken || this.now() >= this.tokenExpiresAt) {\n',
    '      if (!this.accessToken || this.now() >= this.tokenRefreshAt) {\n'
)
regex_once(
    'src/services/trakt-watched.ts',
    r'''    this\.accessToken = response\.access_token;\n'''
    r'''    this\.refreshToken = response\.refresh_token;\n'''
    r'''    this\.tokenExpiresAt = traktTokenTiming\(response, this\.now\(\)\)\.refreshAtMs;\n''',
    '''    this.accessToken = response.access_token;
    this.refreshToken = response.refresh_token;
    const timing = traktTokenTiming(response, this.now());
    this.tokenExpiresAt = timing.expiresAtMs;
    this.tokenRefreshAt = timing.refreshAtMs;
'''
)
regex_once(
    'src/services/trakt-watched.ts',
    r'''      // Legacy v1 state used an obsolete 90-day assumption\. Refresh it immediately\.\n'''
    r'''      this\.tokenExpiresAt = parsed\.schemaVersion === 2 && typeof parsed\.tokenExpiresAt === 'number'\n'''
    r'''        \? parsed\.tokenExpiresAt\n'''
    r'''        : 0;\n''',
    '''      // Legacy v1 state used an obsolete 90-day assumption. Refresh it immediately.
      if (parsed.schemaVersion === 2 && typeof parsed.tokenExpiresAt === 'number') {
        this.tokenExpiresAt = parsed.tokenExpiresAt;
        this.tokenRefreshAt = typeof parsed.tokenRefreshAt === 'number'
          ? parsed.tokenRefreshAt
          : Math.max(0, parsed.tokenExpiresAt - 5 * 60_000);
      } else {
        this.tokenExpiresAt = 0;
        this.tokenRefreshAt = 0;
      }
'''
)
replace_once(
    'src/services/trakt-watched.ts',
    '      tokenExpiresAt: this.tokenExpiresAt\n',
    '      tokenExpiresAt: this.tokenExpiresAt,\n      tokenRefreshAt: this.tokenRefreshAt\n'
)
