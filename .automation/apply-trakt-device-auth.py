from pathlib import Path
import re

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content)


def replace_once(path: str, old: str, new: str) -> None:
    content = read(path)
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected one match, found {count}: {old[:100]!r}')
    write(path, content.replace(old, new, 1))


# quick.sh: expose a standalone Trakt repair mode and delegate OAuth to the
# tested Node helper bundled with the release.
replace_once(
    'quick.sh',
    '  bash quick.sh install [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP]\n'
    '  bash quick.sh upgrade [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP] [--no-trakt]\n',
    '  bash quick.sh install [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP]\n'
    '  bash quick.sh upgrade [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP] [--no-trakt]\n'
    '  bash quick.sh trakt\n'
)
replace_once(
    'quick.sh',
    'Flags:\n  --no-trakt  Skip the Trakt OAuth setup prompt (useful on repeated upgrade runs)\n',
    'Flags:\n  --no-trakt  Skip the Trakt device-auth prompt during install/upgrade.\n\n'
    'The trakt mode repairs only Trakt authentication on an existing installation.\n'
)
replace_once(
    'quick.sh',
    'if [[ "$MODE" != "install" && "$MODE" != "upgrade" ]]; then\n'
    '  echo "First argument must be install or upgrade."\n',
    'if [[ "$MODE" != "install" && "$MODE" != "upgrade" && "$MODE" != "trakt" ]]; then\n'
    '  echo "First argument must be install, upgrade or trakt."\n'
)
quick = read('quick.sh')
pattern = re.compile(r'configure_trakt_oauth\(\) \{.*?\n\}\n\nVERIFICATION_FAILURES=0', re.S)
replacement = r'''run_trakt_device_auth() {
  local helper="$INSTALL_DIR/scripts/trakt-device-auth.mjs"
  local version="unknown"
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    fail "Trakt setup requires an existing environment file: $INSTALL_DIR/.env"
    return 1
  fi
  if [[ ! -f "$helper" ]]; then
    fail "Trakt device-auth helper is missing: $helper"
    echo "Install or upgrade to the current release, then retry: bash quick.sh trakt"
    return 1
  fi
  version="$(node -p "try { require('$INSTALL_DIR/package.json').version } catch { 'unknown' }")"

  say "Trakt Device Code Flow"
  if node "$helper" --env "$INSTALL_DIR/.env" --version "$version"; then
    ok "Trakt credentials were authorised and stored."
    if systemctl is-active --quiet stremio-addarr 2>/dev/null; then
      run_step "Restart stremio-addarr to apply Trakt credentials" sudo systemctl restart stremio-addarr
      wait_for_service stremio-addarr || true
    else
      warn "Service is not active. Start it after reviewing $INSTALL_DIR/.env."
    fi
    return 0
  fi

  local rc=$?
  if [[ "$rc" -eq 2 ]]; then
    warn "Trakt setup skipped; existing Trakt settings were left unchanged."
    return 2
  fi
  fail "Trakt device authentication did not complete."
  echo "Retry without reinstalling: bash quick.sh trakt"
  return "$rc"
}

configure_trakt_oauth() {
  say "Optional Trakt watched-sync setup"
  if ! prompt_confirm "Configure or repair Trakt using Device Code Flow in this quick run?"; then
    warn "Skipping Trakt setup. Run 'bash quick.sh trakt' later to configure or repair it."
    return 0
  fi
  if ! run_trakt_device_auth; then
    local rc=$?
    if [[ "$rc" -ne 2 ]]; then
      warn "Continuing the install/upgrade without changing Trakt authentication."
    fi
  fi
}

VERIFICATION_FAILURES=0'''
quick, count = pattern.subn(replacement, quick, count=1)
if count != 1:
    raise SystemExit('quick.sh: configure_trakt_oauth block not found')
write('quick.sh', quick)
replace_once(
    'quick.sh',
    'run_verification() {\n',
    '''if [[ "$MODE" == "trakt" ]]; then
  say "Repair Trakt authentication for the existing stremio-addarr installation"
  for dependency in node sudo systemctl; do
    check_cmd "$dependency"
  done
  if run_trakt_device_auth; then
    exit 0
  fi
  rc=$?
  [[ "$rc" -eq 2 ]] && exit 0
  exit "$rc"
fi

run_verification() {
'''
)

# Config model: retain device-issued access-token metadata and bind persisted
# state to an authentication generation.
replace_once(
    'src/config.ts',
    '    refreshToken: string;\n    redirectUri: string;\n    stateFilePath: string;\n',
    '    refreshToken: string;\n'
    '    accessToken: string;\n'
    '    accessTokenCreatedAt: number;\n'
    '    accessTokenExpiresIn: number;\n'
    '    redirectUri: string;\n'
    '    authGeneration: string;\n'
    '    stateFilePath: string;\n'
)
old_trakt_config = '''function loadTraktSyncConfig(): AppConfig['traktSync'] {
  const traktSyncEnabled = readBoolean('TRAKT_SYNC_ENABLED', false);
  const traktSyncMinsRaw = Math.floor(readNumber('TRAKT_SYNC_MINS', 360));
  const config = {
    enabled: traktSyncEnabled,
    syncMins: traktSyncMinsRaw,
    apiBaseUrl: ensureHttpUrl('TRAKT_API_BASE_URL', readString('TRAKT_API_BASE_URL', 'https://api.trakt.tv')),
    clientId: readString('TRAKT_CLIENT_ID'),
    clientSecret: readString('TRAKT_CLIENT_SECRET'),
    refreshToken: readString('TRAKT_REFRESH_TOKEN'),
    redirectUri: readString('TRAKT_REDIRECT_URI', 'urn:ietf:wg:oauth:2.0:oob'),
    stateFilePath: readString('TRAKT_SYNC_STATE_FILE', path.resolve(process.cwd(), 'data/trakt-sync-state.json'))
  };

  if (config.enabled) {
    readRequiredString('TRAKT_CLIENT_ID');
    readRequiredString('TRAKT_CLIENT_SECRET');
    readRequiredString('TRAKT_REFRESH_TOKEN');
    if (config.syncMins < 40) throw new Error('TRAKT_SYNC_MINS must be at least 40.');
  }

  return config;
}
'''
new_trakt_config = '''function loadTraktSyncConfig(): AppConfig['traktSync'] {
  const traktSyncEnabled = readBoolean('TRAKT_SYNC_ENABLED', false);
  const traktSyncMinsRaw = Math.floor(readNumber('TRAKT_SYNC_MINS', 360));
  const accessTokenCreatedAt = Math.max(0, Math.floor(readNumber('TRAKT_ACCESS_TOKEN_CREATED_AT', 0)));
  const accessTokenExpiresIn = Math.max(0, Math.floor(readNumber('TRAKT_ACCESS_TOKEN_EXPIRES_IN', 0)));
  const config = {
    enabled: traktSyncEnabled,
    syncMins: traktSyncMinsRaw,
    apiBaseUrl: ensureHttpUrl('TRAKT_API_BASE_URL', readString('TRAKT_API_BASE_URL', 'https://api.trakt.tv')),
    clientId: readString('TRAKT_CLIENT_ID'),
    clientSecret: readString('TRAKT_CLIENT_SECRET'),
    refreshToken: readString('TRAKT_REFRESH_TOKEN'),
    accessToken: readString('TRAKT_ACCESS_TOKEN'),
    accessTokenCreatedAt,
    accessTokenExpiresIn,
    redirectUri: readString('TRAKT_REDIRECT_URI'),
    authGeneration: readString('TRAKT_AUTH_GENERATION'),
    stateFilePath: readString('TRAKT_SYNC_STATE_FILE', path.resolve(process.cwd(), 'data/trakt-sync-state.json'))
  };

  if (config.enabled) {
    readRequiredString('TRAKT_CLIENT_ID');
    readRequiredString('TRAKT_CLIENT_SECRET');
    readRequiredString('TRAKT_REFRESH_TOKEN');
    readRequiredString('TRAKT_REDIRECT_URI');
    if (config.syncMins < 40) throw new Error('TRAKT_SYNC_MINS must be at least 40.');
  }

  return config;
}
'''
replace_once('src/config.ts', old_trakt_config, new_trakt_config)

# Configuration UI invalidates old runtime state whenever credentials change.
replace_once(
    'src/config-ui-core.ts',
    "  'TRAKT_REFRESH_TOKEN',\n  'TRAKT_REDIRECT_URI',\n",
    "  'TRAKT_REFRESH_TOKEN',\n"
    "  'TRAKT_ACCESS_TOKEN',\n"
    "  'TRAKT_ACCESS_TOKEN_CREATED_AT',\n"
    "  'TRAKT_ACCESS_TOKEN_EXPIRES_IN',\n"
    "  'TRAKT_REDIRECT_URI',\n"
    "  'TRAKT_AUTH_GENERATION',\n"
)
old_ui_trakt = '''  const traktEnabled = readBooleanField(trakt, 'enabled', config.traktSync.enabled);
  const traktClientId = readStringField(trakt, 'clientId');
  const traktClientSecret = readStringField(trakt, 'clientSecret');
  const traktRefreshToken = readStringField(trakt, 'refreshToken');
  const hasClientId = Boolean(traktClientId || currentEnv.get('TRAKT_CLIENT_ID') || config.traktSync.clientId);
  const hasClientSecret = Boolean(traktClientSecret || currentEnv.get('TRAKT_CLIENT_SECRET') || config.traktSync.clientSecret);
  const hasRefreshToken = Boolean(traktRefreshToken || currentEnv.get('TRAKT_REFRESH_TOKEN') || config.traktSync.refreshToken);
  if (traktEnabled && (!hasClientId || !hasClientSecret || !hasRefreshToken)) {
    throw new Error('Trakt client ID, client secret and refresh token are required when Trakt sync is enabled.');
  }
  set('TRAKT_SYNC_ENABLED', traktEnabled);
  set('TRAKT_SYNC_MINS', readIntegerField(trakt, 'syncMins', config.traktSync.syncMins, 40));
  set('TRAKT_API_BASE_URL', normalizeHttpUrl(trakt['apiBaseUrl'], 'Trakt API URL'));
  if (traktClientId) set('TRAKT_CLIENT_ID', traktClientId);
  if (traktClientSecret) set('TRAKT_CLIENT_SECRET', traktClientSecret);
  if (traktRefreshToken) set('TRAKT_REFRESH_TOKEN', traktRefreshToken);
  set('TRAKT_REDIRECT_URI', readStringField(trakt, 'redirectUri', config.traktSync.redirectUri) || 'urn:ietf:wg:oauth:2.0:oob');
'''
new_ui_trakt = '''  const traktEnabled = readBooleanField(trakt, 'enabled', config.traktSync.enabled);
  const traktClientId = readStringField(trakt, 'clientId');
  const traktClientSecret = readStringField(trakt, 'clientSecret');
  const traktRefreshToken = readStringField(trakt, 'refreshToken');
  const previousClientId = currentEnv.get('TRAKT_CLIENT_ID') || config.traktSync.clientId;
  const previousClientSecret = currentEnv.get('TRAKT_CLIENT_SECRET') || config.traktSync.clientSecret;
  const previousRefreshToken = currentEnv.get('TRAKT_REFRESH_TOKEN') || config.traktSync.refreshToken;
  const previousRedirectUri = currentEnv.get('TRAKT_REDIRECT_URI') || config.traktSync.redirectUri;
  const redirectUri = readStringField(trakt, 'redirectUri', previousRedirectUri);
  const effectiveClientId = traktClientId || previousClientId;
  const effectiveClientSecret = traktClientSecret || previousClientSecret;
  const effectiveRefreshToken = traktRefreshToken || previousRefreshToken;
  if (traktEnabled && (!effectiveClientId || !effectiveClientSecret || !effectiveRefreshToken || !redirectUri)) {
    throw new Error('Trakt client ID, client secret, refresh token and exact application redirect URI are required when Trakt sync is enabled.');
  }
  set('TRAKT_SYNC_ENABLED', traktEnabled);
  set('TRAKT_SYNC_MINS', readIntegerField(trakt, 'syncMins', config.traktSync.syncMins, 40));
  set('TRAKT_API_BASE_URL', normalizeHttpUrl(trakt['apiBaseUrl'], 'Trakt API URL'));
  if (traktClientId) set('TRAKT_CLIENT_ID', traktClientId);
  if (traktClientSecret) set('TRAKT_CLIENT_SECRET', traktClientSecret);
  if (traktRefreshToken) set('TRAKT_REFRESH_TOKEN', traktRefreshToken);
  set('TRAKT_REDIRECT_URI', redirectUri);

  const traktCredentialsChanged =
    (traktClientId && traktClientId !== previousClientId)
    || (traktClientSecret && traktClientSecret !== previousClientSecret)
    || (traktRefreshToken && traktRefreshToken !== previousRefreshToken)
    || redirectUri !== previousRedirectUri;
  if (traktCredentialsChanged) {
    set('TRAKT_ACCESS_TOKEN', '');
    set('TRAKT_ACCESS_TOKEN_CREATED_AT', 0);
    set('TRAKT_ACCESS_TOKEN_EXPIRES_IN', 0);
    set('TRAKT_AUTH_GENERATION', randomUUID().replaceAll('-', ''));
  }
'''
replace_once('src/config-ui-core.ts', old_ui_trakt, new_ui_trakt)
replace_once(
    'src/config-ui-core.ts',
    '          <p class="muted">Trakt credentials are validated locally on save. The refresh flow runs after restart; the UI does not rotate tokens merely to test them.</p>\n',
    '          <p class="muted">Recommended authentication uses <code>bash quick.sh trakt</code>. Manual credentials saved here must include the exact case-sensitive redirect URI from the Trakt application; changed credentials invalidate older runtime token state.</p>\n'
)

# Use the documented API only; no HTML scraping fallback.
replace_once(
    'src/services/status.ts',
    "import { TraktHtmlLookup, TraktApiLookup, type TraktLookup } from './trakt.js';",
    "import { NoopTraktLookup, TraktApiLookup, type TraktLookup } from './trakt.js';"
)
replace_once(
    'src/services/status.ts',
    "    this.traktLookup = deps?.traktLookup ?? (config.traktSync.clientId ? new TraktApiLookup(config.traktSync.clientId) : new TraktHtmlLookup());",
    "    this.traktLookup = deps?.traktLookup ?? (config.traktSync.clientId\n"
    "      ? new TraktApiLookup(config.traktSync.clientId, config.traktSync.apiBaseUrl, config.version)\n"
    "      : new NoopTraktLookup());"
)

# Runtime refresh errors should clearly request reauthorization.
replace_once(
    'src/services/trakt-watched.ts',
    '''    const response = await refreshTraktToken(
      this.config.traktSync.apiBaseUrl,
      this.config.traktSync.clientId,
      this.config.traktSync.clientSecret,
      this.refreshToken,
      this.config.traktSync.redirectUri,
      this.userAgent,
      {
        timeoutMs: this.config.requestTimeoutMs,
        sleep: this.sleep
      }
    );
    this.applyToken(response);
''',
    '''    let response: TraktTokenResponse;
    try {
      response = await refreshTraktToken(
        this.config.traktSync.apiBaseUrl,
        this.config.traktSync.clientId,
        this.config.traktSync.clientSecret,
        this.refreshToken,
        this.config.traktSync.redirectUri,
        this.userAgent,
        {
          timeoutMs: this.config.requestTimeoutMs,
          sleep: this.sleep
        }
      );
    } catch (error) {
      if (error instanceof TraktAuthError && (error.status === 400 || error.status === 401)) {
        throw new Error('trakt_reauthorization_required');
      }
      throw error;
    }
    this.applyToken(response);
'''
)
replace_once(
    'src/services/trakt-watched.ts',
    '''    await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    await fs.chmod(directory, 0o700).catch(() => undefined);
''',
    '''    const createdDirectory = await fs.mkdir(directory, { recursive: true, mode: 0o700 });
    if (createdDirectory) await fs.chmod(directory, 0o700).catch(() => undefined);
'''
)

# Test fixtures satisfy the expanded config contract.
replace_once(
    'test/_helpers.ts',
    '''      refreshToken: '',
      redirectUri: 'urn:ietf:wg:oauth:2.0:oob',
      stateFilePath: '/tmp/stremio-addarr-test-trakt-sync.json'
''',
    '''      refreshToken: '',
      accessToken: '',
      accessTokenCreatedAt: 0,
      accessTokenExpiresIn: 0,
      redirectUri: 'https://example.invalid/trakt/callback',
      authGeneration: '',
      stateFilePath: '/tmp/stremio-addarr-test-trakt-sync.json'
'''
)

# Environment template documents device-issued metadata and exact redirect matching.
replace_once(
    '.env.example',
    '''#── Trakt watched sync (optional, server-managed tokens) ─────────────────────
#   NOTE: Stremio does not forward native account sessions to third-party addons.
#   If enabled, this addon performs its own Trakt OAuth refresh-token flow.
#TRAKT_SYNC_ENABLED=false
#TRAKT_SYNC_MINS=360  #   forced to >=40 (values <=40 become 40)
#TRAKT_API_BASE_URL=https://api.trakt.tv
#TRAKT_CLIENT_ID=
#TRAKT_CLIENT_SECRET=
#TRAKT_REFRESH_TOKEN=
#TRAKT_REDIRECT_URI=urn:ietf:wg:oauth:2.0:oob
#TRAKT_SYNC_STATE_FILE=./data/trakt-sync-state.json
''',
    '''#── Trakt watched sync (optional, server-managed tokens) ─────────────────────
# Stremio does not forward native account sessions to third-party addons.
# Recommended setup/repair: bash quick.sh trakt
# Device Code Flow writes access/refresh tokens and provider expiry metadata.
# TRAKT_REDIRECT_URI must exactly (including case) match the Trakt application;
# it is required when the refresh token is rotated after device authorization.
#TRAKT_SYNC_ENABLED=false
#TRAKT_SYNC_MINS=360  # minimum 40
#TRAKT_API_BASE_URL=https://api.trakt.tv
#TRAKT_CLIENT_ID=
#TRAKT_CLIENT_SECRET=
#TRAKT_REFRESH_TOKEN=
#TRAKT_ACCESS_TOKEN=
#TRAKT_ACCESS_TOKEN_CREATED_AT=
#TRAKT_ACCESS_TOKEN_EXPIRES_IN=
#TRAKT_REDIRECT_URI=https://exact-value-from-your-trakt-app.example/callback
#TRAKT_AUTH_GENERATION=
#TRAKT_SYNC_STATE_FILE=./data/trakt-sync-state.json
'''
)

# Release package includes the standalone helper.
replace_once(
    'scripts/package-release.mjs',
    "  'docs/CONFIGURATION_UI.md',\n  '.env.example',\n",
    "  'docs/CONFIGURATION_UI.md',\n  'scripts/trakt-device-auth.mjs',\n  '.env.example',\n"
)
replace_once(
    'scripts/package-release.mjs',
    "stage('docs', 'docs');\n\n// Runtime web assets",
    "stage('docs', 'docs');\nstage('scripts/trakt-device-auth.mjs');\n\n// Runtime web assets"
)

# Installer regressions ensure the obsolete OOB flow cannot return.
quick_test = read('test/quick-script.test.ts')
quick_test += '''

test('quick.sh exposes retryable standalone Trakt device authentication', () => {
  const helper = readFileSync(path.join(root, 'scripts/trakt-device-auth.mjs'), 'utf8');
  assert.match(quick, /bash quick\.sh trakt/);
  assert.match(quick, /trakt-device-auth\.mjs/);
  assert.match(helper, /requestTraktDeviceCode/);
  assert.match(helper, /pollTraktDeviceToken/);
  assert.match(helper, /retry refresh/);
  assert.match(helper, /new device code/);
  assert.doesNotMatch(quick + helper, /oauth\/authorize/);
  assert.doesNotMatch(quick + helper, /urn:ietf:wg:oauth:2\.0:oob/);
  assert.doesNotThrow(() => execFileSync('node', ['--check', 'scripts/trakt-device-auth.mjs'], { cwd: root, stdio: 'pipe' }));
});
'''
write('test/quick-script.test.ts', quick_test)

# Changelog.
replace_once(
    'CHANGELOG.md',
    '### Fixed\n\n',
    '### Fixed\n\n'
    '- Replace the broken Trakt OOB authorization-code setup with Trakt Device Code Flow, exact interval/expiry polling, bounded retries and a standalone `bash quick.sh trakt` repair mode.\n'
    '- Prevent stale persisted Trakt state from overriding newly authorised credentials after restart.\n'
    '- Use provider token expiry metadata, proactive refresh, `Retry-After`, required Trakt headers and atomic `0600` token-state persistence.\n'
)
replace_once(
    'CHANGELOG.md',
    '### Changed\n\n',
    '### Changed\n\n'
    '- Remove unsupported Trakt website scraping; release-date fallback now uses documented Trakt API methods only when a Client ID is configured.\n'
)

# Documentation and source must not retain the obsolete OOB URI or HTML scraper.
for path in ['quick.sh', '.env.example', 'docs/TRAKT.md', 'src/config.ts', 'src/config-ui-core.ts', 'test/_helpers.ts']:
    if 'urn:ietf:wg:oauth:2.0:oob' in read(path):
        raise SystemExit(f'{path}: obsolete OOB redirect remains')
if 'TraktHtmlLookup' in read('src/services/status.ts') or 'TraktHtmlLookup' in read('src/services/trakt.ts'):
    raise SystemExit('Trakt HTML scraping remains')
