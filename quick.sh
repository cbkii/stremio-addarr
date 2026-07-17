#!/usr/bin/env bash
set -Eeuo pipefail

###############################################################################
# QUICK INSTALL / UPGRADE GUIDE SCRIPT
# -----------------------------------------------------------------------------
# This script is intentionally verbose and interactive so operators can use it
# as both:
#   1) an automation helper, and
#   2) a readable operational reference.
#
# Supported high-level flows:
#   - install: first-time setup on a host
#   - upgrade: in-place update keeping existing local config/service wiring
###############################################################################

MODE="${1:-}"
if [[ -z "$MODE" || "$MODE" == "-h" || "$MODE" == "--help" ]]; then
  cat <<'EOF'
Usage:
  bash quick.sh install [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP]
  bash quick.sh upgrade [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP] [--no-trakt]

Flags:
  --no-trakt  Skip the Trakt OAuth setup prompt (useful on repeated upgrade runs)

Defaults:
  --repo cbkii/stremio-addarr
  --tag  optional, defaults to latest release
  --svc-user current user
  --svc-group current user's primary group
EOF
  exit 0
fi

shift || true

REPO="cbkii/stremio-addarr"
TAG=""
SVC_USER="${SVC_USER:-$(whoami)}"
SVC_GROUP="${SVC_GROUP:-$(id -gn)}"
INSTALL_DIR="/opt/stremio-addarr"
SERVICE_PATH="/etc/systemd/system/stremio-addarr.service"
ASSET_NAME="stremio-addarr-install.tar.gz"
CHECKSUM_NAME="${ASSET_NAME}.sha256"
SKIP_TRAKT=false

# Parse optional flags (repo/tag/service account overrides).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --svc-user) SVC_USER="$2"; shift 2 ;;
    --svc-group) SVC_GROUP="$2"; shift 2 ;;
    --no-trakt) SKIP_TRAKT=true; shift ;;
    *)
      echo "Unknown argument: $1"
      exit 1
      ;;
  esac
done

if [[ "$MODE" != "install" && "$MODE" != "upgrade" ]]; then
  echo "First argument must be install or upgrade."
  exit 1
fi

# Configure ANSI colors when output is a terminal; otherwise use plain text.
if [[ -t 1 ]]; then
  C_RESET=$'\033[0m'; C_BOLD=$'\033[1m'; C_BLUE=$'\033[34m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_RED=$'\033[31m'
else
  C_RESET=""; C_BOLD=""; C_BLUE=""; C_GREEN=""; C_YELLOW=""; C_RED=""
fi

say() { echo -e "${C_BLUE}${C_BOLD}==>${C_RESET} $*"; }
ok() { echo -e "${C_GREEN}${C_BOLD}[OK]${C_RESET} $*"; }
warn() { echo -e "${C_YELLOW}${C_BOLD}[WARN]${C_RESET} $*"; }
fail() { echo -e "${C_RED}${C_BOLD}[FAIL]${C_RESET} $*"; }
cmd() { echo -e "${C_BLUE}${C_BOLD}[»]${C_RESET} $*"; }
ask() { echo -e "${C_YELLOW}${C_BOLD}[?]${C_RESET} $*"; }

TMP_DIR="$(mktemp -d)"
_cleanup() { rm -rf "$TMP_DIR"; }
trap '_cleanup' EXIT
trap '_cleanup; echo; warn "Aborted by signal. .env and service state may be inconsistent — review before re-running."; exit 130' INT TERM

# Helper: run one named step, capture output, and show a clear failure block.
run_step() {
  local desc="$1"; shift
  local log="$TMP_DIR/cmd.log"
  say "$desc"
  cmd "$*"
  if "$@" >"$log" 2>&1; then
    ok "$desc"
  else
    fail "$desc"
    echo -e "${C_RED}${C_BOLD}----- COMMAND OUTPUT BEGIN -----${C_RESET}"
    cat "$log"
    echo -e "${C_RED}${C_BOLD}----- COMMAND OUTPUT END -----${C_RESET}"
    exit 1
  fi
}

# Helper: run one named step while streaming output to terminal.
run_step_live() {
  local desc="$1"; shift
  say "$desc"
  cmd "$*"
  if "$@"; then
    ok "$desc"
  else
    fail "$desc"
    exit 1
  fi
}

# Helper: show command output to terminal without failing the script when command
# returns non-zero (e.g., diff when files differ).
show_step_output() {
  local desc="$1"; shift
  say "$desc"
  cmd "$*"
  if "$@"; then
    ok "$desc"
  else
    warn "$desc (command returned non-zero; continuing)"
  fi
}

# Helper: prompt for yes/no confirmation.
prompt_confirm() {
  local question="$1"
  local ans=""
  while true; do
    ask "$question"
    read -r -p "${C_YELLOW}${C_BOLD}[y/N]: ${C_RESET}" ans
    case "${ans,,}" in
      y|yes) return 0 ;;
      n|no|"") return 1 ;;
      *) warn "Please enter y or n." ;;
    esac
  done
}

# Helper: merge existing .env values into .env.example template shape.
# - Reads keys from commented and uncommented assignment lines.
# - Prefers existing .env values for keys present in template.
# - Preserves template comments/layout for unknown lines.
# - Appends custom keys from existing .env that template does not include.
merge_env_with_template() {
  local current_env="$1"
  local template_env="$2"
  local output_env="$3"

  awk -v existing_file="$current_env" '
    function parse_assignment(line, key_out, val_out,  w, m) {
      w = line
      sub(/\r$/, "", w)
      if (w ~ /^[[:space:]]*$/) return 0
      if (w ~ /^[[:space:]]*#/) sub(/^[[:space:]]*#[[:space:]]*/, "", w)
      if (match(w, /^([A-Za-z_][A-Za-z0-9_]*)[[:space:]]*=(.*)$/, m)) {
        key_out[1] = m[1]
        val_out[1] = m[2]
        return 1
      }
      return 0
    }

    BEGIN {
      while ((getline line < existing_file) > 0) {
        delete key_buf
        delete val_buf
        # Commented examples are documentation, not configured values. Keeping
        # them caused placeholder tokens to override real upgrade settings.
        if (line ~ /^[[:space:]]*#/) continue
        if (parse_assignment(line, key_buf, val_buf)) {
          key = key_buf[1]
          if (!(key in existing_vals)) {
            existing_vals[key] = val_buf[1]
            existing_order[++existing_count] = key
          }
        }
      }
      close(existing_file)
    }

    {
      line = $0
      delete key_buf
      delete val_buf
      if (parse_assignment(line, key_buf, val_buf)) {
        key = key_buf[1]
        template_seen[key] = 1
        if (key in existing_vals) {
          print key "=" existing_vals[key]
        } else {
          print line
        }
      } else {
        print line
      }
    }

    END {
      appended = 0
      for (i = 1; i <= existing_count; i++) {
        key = existing_order[i]
        if (!(key in template_seen)) {
          if (!appended) {
            print ""
            print "# --- Preserved custom entries from previous .env ---"
            appended = 1
          }
          print key "=" existing_vals[key]
        }
      }
    }
  ' "$template_env" > "$output_env"
}

# Helper: ensure required command-line dependencies exist.
check_cmd() {
  local c="$1"
  if command -v "$c" >/dev/null 2>&1; then
    ok "Found dependency: $c"
  else
    fail "Missing required dependency: $c"
    exit 1
  fi
}

# Helper: approval gate (y=proceed, n=open file in editor, then re-prompt).
prompt_gate() {
  local title="$1"
  local edit_file="$2"
  while true; do
    echo
    ask "${C_BOLD}${title}${C_RESET}"
    read -r -p "${C_YELLOW}${C_BOLD}Approve and continue? [y] yes / [n] pause and edit: ${C_RESET}" ans
    case "${ans,,}" in
      y|yes)
        ok "Approved by operator."
        break
        ;;
      n|no)
        if [[ -n "$edit_file" ]]; then
          if [[ ! -t 0 || ! -t 1 ]]; then
            fail "Interactive editor requested but no TTY is available."
            echo "Re-run from an interactive shell or manually edit: $edit_file"
            exit 1
          fi
          local editor
          editor="$(pick_editor)"
          if [[ -z "$editor" ]]; then
            warn "No interactive editor found (tried nano, vi). Manually edit the file and re-run:"
            warn "  $edit_file"
            exit 1
          fi
          run_step_live "Open $edit_file in ${editor} for manual edits" "$editor" "$edit_file"
        else
          warn "No edit file provided for this gate."
        fi
        ;;
      *)
        warn "Please enter y or n."
        ;;
    esac
  done
}

# Helper: consistent OK|WARN|FAIL verification output.
print_status_line() {
  local kind="$1"
  local msg="$2"
  case "$kind" in
    OK) ok "OK: $msg" ;;
    WARN) warn "WARN: $msg" ;;
    FAIL) fail "FAIL: $msg" ;;
  esac
}

# Helper: colorized diff (prefers icdiff; falls back to diff --color=always).
coloured_diff() {
  if [[ "$HAVE_ICDIFF" == "true" ]]; then
    icdiff "$@" || true
  else
    diff --color=always -u "$@" || true
  fi
}

# Helper: pick the best available interactive editor (nano preferred).
pick_editor() {
  if command -v nano >/dev/null 2>&1; then
    echo nano
  elif [[ -n "${EDITOR:-}" ]] && command -v "${EDITOR}" >/dev/null 2>&1; then
    echo "${EDITOR}"
  elif command -v vi >/dev/null 2>&1; then
    echo vi
  else
    echo ""
  fi
}

load_env_file() {
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    set +u
    # WARNING: .env is sourced directly. It must be operator-controlled and
    # must not contain untrusted shell code.
    # shellcheck disable=SC1090,SC1091
    source "$INSTALL_DIR/.env"
    set -u
  fi
}

upsert_env_key() {
  local key="$1"
  local value="$2"
  local env_file="$INSTALL_DIR/.env"
  if grep -Eq "^[[:space:]]*${key}=" "$env_file"; then
    # Active (uncommented) assignment exists — update it in place
    sed -i -E "s|^[[:space:]]*${key}=.*$|${key}=${value}|" "$env_file"
  elif grep -Eq "^[[:space:]]*#[[:space:]]*${key}=" "$env_file"; then
    # Only a commented-out version exists — replace the first comment with the live assignment
    sed -i -E "0,/^[[:space:]]*#[[:space:]]*${key}=.*$/{s|^[[:space:]]*#[[:space:]]*${key}=.*$|${key}=${value}|}" "$env_file"
  else
    # Key is absent entirely — append
    printf '\n%s=%s\n' "$key" "$value" >> "$env_file"
  fi
}

generate_short_token() {
  # Six random bytes encode to exactly eight URL-safe base64 characters.
  openssl rand -base64 6 | tr '+/' '-_' | tr -d '=\n'
}

read_env_value() {
  local key="$1"
  [[ -f "$INSTALL_DIR/.env" ]] || { printf '\\n'; return 0; }
  awk -v key="$key" '
    /^[[:space:]]*#/ { next }
    {
      line = $0
      sub(/\r$/, "", line)
      if (line ~ "^[[:space:]]*" key "[[:space:]]*=") {
        sub("^[[:space:]]*" key "[[:space:]]*=", "", line)
        value = line
      }
    }
    END { print value }
  ' "$INSTALL_DIR/.env"
}

is_runtime_token() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{8,128}$ ]]
}

is_short_token() {
  [[ "$1" =~ ^[A-Za-z0-9_-]{8}$ ]]
}

choose_token() {
  local key="$1"
  local label="$2"
  local purpose="$3"
  local current choice value prompt
  current="$(read_env_value "$key")"

  echo
  say "$label"
  echo "$purpose"
  if is_runtime_token "$current"; then
    echo "Current value: configured (${#current} characters)."
    prompt="Choose [k] keep / [s] specify exactly 8 characters / [g] generate random 8 characters [k]: "
  else
    echo "Current value: not configured or invalid."
    prompt="Choose [s] specify exactly 8 characters / [g] generate random 8 characters [g]: "
  fi

  while true; do
    read -r -p "${C_YELLOW}${C_BOLD}${prompt}${C_RESET}" choice
    choice="${choice,,}"
    if [[ -z "$choice" ]]; then
      if is_runtime_token "$current"; then choice="k"; else choice="g"; fi
    fi
    case "$choice" in
      k|keep)
        if is_runtime_token "$current"; then
          ok "Keeping existing $key."
          return 0
        fi
        warn "There is no valid token to keep."
        ;;
      s|specify)
        read -r -p "${C_YELLOW}${C_BOLD}Enter exactly 8 URL-safe characters [A-Za-z0-9_-]: ${C_RESET}" value
        if ! is_short_token "$value"; then
          warn "Use exactly 8 characters containing only letters, numbers, _ or -."
          continue
        fi
        upsert_env_key "$key" "$value"
        ok "$key set to: $value"
        return 0
        ;;
      g|generate)
        value="$(generate_short_token)"
        upsert_env_key "$key" "$value"
        ok "$key generated: $value"
        echo "Record this value now; it is intentionally short for TV entry."
        return 0
        ;;
      *) warn "Choose keep, specify or generate." ;;
    esac
  done
}

prompt_config_ui_enabled() {
  local current answer default_prompt
  current="$(read_env_value CONFIG_UI_ENABLED)"
  case "${current,,}" in
    true|1|yes|on) current="true"; default_prompt="[Y/n]" ;;
    *) current="false"; default_prompt="[y/N]" ;;
  esac
  while true; do
    read -r -p "${C_YELLOW}${C_BOLD}Enable the Stremio/browser configuration UI? $default_prompt: ${C_RESET}" answer
    answer="${answer,,}"
    if [[ -z "$answer" ]]; then answer="$current"; fi
    case "$answer" in
      y|yes|true|1|on) upsert_env_key CONFIG_UI_ENABLED true; return 0 ;;
      n|no|false|0|off) upsert_env_key CONFIG_UI_ENABLED false; return 0 ;;
      *) warn "Please enter y or n." ;;
    esac
  done
}

configure_tokens() {
  say "Token setup"
  echo "The add-on access token forms the private Stremio manifest path."
  echo "The configuration token unlocks server settings and is never part of the manifest URL."
  echo "New random tokens are 8 characters. Existing longer tokens remain supported."

  choose_token ADDON_ACCESS_TOKEN "Add-on access token" \
    "Used in /<token>/manifest.json and /<token>/configure."

  prompt_config_ui_enabled
  if [[ "$(read_env_value CONFIG_UI_ENABLED)" == "true" ]]; then
    choose_token CONFIG_UI_TOKEN "Configuration UI token" \
      "Entered on the Configure page to unlock editing."
  else
    warn "Configuration UI disabled; /configure will not be exposed."
  fi

  local logo
  logo="$(read_env_value MANIFEST_LOGO_URL)"
  if [[ "$logo" == *'${PUBLIC_BASE_URL}'* || "$logo" == *'$PUBLIC_BASE_URL'* ]]; then
    upsert_env_key MANIFEST_LOGO_URL local
    warn "Migrated MANIFEST_LOGO_URL to 'local'; systemd EnvironmentFile values do not expand nested variables."
  fi
}

configure_trakt_oauth() {
  say "Optional Trakt OAuth setup"
  if ! prompt_confirm "Configure Trakt watched-sync OAuth in this quick run?"; then
    warn "Skipping Trakt OAuth setup."
    return 0
  fi

  load_env_file

  local trakt_client_id="${TRAKT_CLIENT_ID:-}"
  local trakt_client_secret="${TRAKT_CLIENT_SECRET:-}"
  local trakt_api_base_url="${TRAKT_API_BASE_URL:-https://api.trakt.tv}"
  local trakt_redirect_uri="${TRAKT_REDIRECT_URI:-urn:ietf:wg:oauth:2.0:oob}"
  local code=""
  local response_file="$TMP_DIR/trakt-token.json"
  local token_http_code=""
  local refresh_token=""
  local access_token=""
  local short_refresh=""
  local short_access=""

  if [[ -z "$trakt_client_id" ]]; then
    ask "Enter TRAKT_CLIENT_ID:"
    read -r -p "${C_YELLOW}${C_BOLD}TRAKT_CLIENT_ID: ${C_RESET}" trakt_client_id
    upsert_env_key "TRAKT_CLIENT_ID" "$trakt_client_id"
  fi
  if [[ -z "$trakt_client_secret" ]]; then
    ask "Enter TRAKT_CLIENT_SECRET:"
    read -r -p "${C_YELLOW}${C_BOLD}TRAKT_CLIENT_SECRET: ${C_RESET}" trakt_client_secret
    upsert_env_key "TRAKT_CLIENT_SECRET" "$trakt_client_secret"
  fi

  # Validate credentials are present before building the auth URL
  if [[ -z "$trakt_client_id" || -z "$trakt_client_secret" ]]; then
    fail "TRAKT_CLIENT_ID and TRAKT_CLIENT_SECRET are required for OAuth. Skipping."
    return 0
  fi

  upsert_env_key "TRAKT_API_BASE_URL" "$trakt_api_base_url"
  upsert_env_key "TRAKT_REDIRECT_URI" "$trakt_redirect_uri"

  # Intentionally minimal URL-encode: only handles the characters present in the
  # known OOB redirect URI (urn:ietf:wg:oauth:2.0:oob). If TRAKT_REDIRECT_URI is
  # ever changed to a different value, this encoding logic must be revisited.
  local encoded_redirect_uri
  encoded_redirect_uri="$(printf '%s' "$trakt_redirect_uri" | sed -e 's/%/%25/g' -e 's/:/%3A/g' -e 's/\//%2F/g')"
  local auth_url="https://trakt.tv/oauth/authorize?response_type=code&client_id=${trakt_client_id}&redirect_uri=${encoded_redirect_uri}"
  say "Complete Trakt authorization"
  echo "1) Open this URL in any browser and approve access:"
  echo "   $auth_url"
  echo "2) Copy the authorization code shown by Trakt."
  ask "Paste authorization code:"
  read -r -p "${C_YELLOW}${C_BOLD}Authorization code: ${C_RESET}" code

  # Trim leading/trailing whitespace from pasted code
  code="${code#"${code%%[![:space:]]*}"}"
  code="${code%"${code##*[![:space:]]}"}"

  if [[ -z "$code" ]]; then
    fail "Authorization code was empty. Skipping Trakt OAuth."
    return 0
  fi

  say "Exchange authorization code for refresh token"
  cmd "curl -sS -X POST ${trakt_api_base_url}/oauth/token -H Content-Type: application/json ..."
  token_http_code="$(
    curl -sS -o "$response_file" -w '%{http_code}' \
      -X POST "${trakt_api_base_url}/oauth/token" \
      -H 'Content-Type: application/json' \
      -d "{\"code\":\"${code}\",\"client_id\":\"${trakt_client_id}\",\"client_secret\":\"${trakt_client_secret}\",\"redirect_uri\":\"${trakt_redirect_uri}\",\"grant_type\":\"authorization_code\"}"
  )"

  if [[ "$token_http_code" != "200" ]]; then
    fail "Trakt token exchange failed (HTTP ${token_http_code})."
    cat "$response_file"
    warn "You can re-run quick.sh and choose Trakt OAuth setup again."
    return 0
  fi

  refresh_token="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.refresh_token||'');" "$response_file")"
  access_token="$(node -e "const fs=require('fs');const j=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));process.stdout.write(j.access_token||'');" "$response_file")"

  if [[ -z "$refresh_token" ]]; then
    fail "Trakt token response did not include refresh_token."
    cat "$response_file"
    return 0
  fi

  upsert_env_key "TRAKT_REFRESH_TOKEN" "$refresh_token"
  upsert_env_key "TRAKT_ACCESS_TOKEN" "${access_token:-}"
  upsert_env_key "TRAKT_SYNC_ENABLED" "true"
  # Only set TRAKT_SYNC_MINS if it does not already have a valid numeric value;
  # an existing blank value is treated as absent to prevent the service from
  # crashing with "must be a number".
  if ! grep -Eq '^[[:space:]]*TRAKT_SYNC_MINS=[[:space:]]*[0-9]+' "$INSTALL_DIR/.env"; then
    upsert_env_key "TRAKT_SYNC_MINS" "360"
  fi

  short_refresh="${refresh_token:0:6}...${refresh_token: -4}"
  short_access="${access_token:0:6}...${access_token: -4}"
  ok "Stored Trakt OAuth tokens in .env (refresh=${short_refresh}, access=${short_access})."

  # Restart the service so TRAKT_* values (including TRAKT_SYNC_MINS) are picked up.
  # systemd does not hot-reload EnvironmentFile, so a restart is required.
  if systemctl is-active --quiet stremio-addarr 2>/dev/null; then
    run_step "Restart stremio-addarr to apply Trakt OAuth config" sudo systemctl restart stremio-addarr
    wait_for_service stremio-addarr || true
  else
    warn "Service was not active; skipping restart. Start it manually after reviewing .env."
  fi
}

VERIFICATION_FAILURES=0
VERIFY_ERRORS=()

# Helper: poll until service becomes active or timeout expires.
# Does not exit the script on timeout — verification section will catch it.
wait_for_service() {
  local svc="$1"
  local timeout="${2:-15}"
  local i=0
  local stable=0
  while (( i < timeout )); do
    if systemctl is-active --quiet "$svc" 2>/dev/null; then
      stable=$((stable + 1))
      if (( stable >= 3 )); then
        ok "Service $svc remained active for three consecutive checks."
        return 0
      fi
    else
      stable=0
    fi
    sleep 1
    (( i++ )) || true
  done
  warn "Service $svc did not remain stably active within ${timeout}s."
  warn "Recent logs from the current service invocation:"
  local invocation
  invocation="$(systemctl show "$svc" -p InvocationID --value 2>/dev/null || true)"
  if [[ -n "$invocation" ]]; then
    sudo journalctl "_SYSTEMD_INVOCATION_ID=$invocation" -n 40 --no-pager || true
  else
    sudo journalctl -u "$svc" -n 40 --no-pager || true
  fi
  return 1
}

run_verification() {
  local desc="$1"; shift
  local log="$TMP_DIR/verify.log"
  say "$desc"
  cmd "$*"
  if "$@" >"$log" 2>&1; then
    print_status_line OK "$desc"
  else
    print_status_line FAIL "$desc"
    echo -e "${C_RED}${C_BOLD}----- VERIFICATION OUTPUT BEGIN -----${C_RESET}"
    cat "$log"
    echo -e "${C_RED}${C_BOLD}----- VERIFICATION OUTPUT END -----${C_RESET}"
    VERIFICATION_FAILURES=$((VERIFICATION_FAILURES + 1))
    VERIFY_ERRORS+=("$desc")
  fi
}

# Helper: normalize semver tag input so 1.2.3 and v1.2.3 behave the same.
normalize_tag() {
  local t="$1"
  if [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.].*)?$ ]]; then
    echo "v$t"
  else
    echo "$t"
  fi
}

# Helper: verify the downloaded archive checksum.
# Primary path: checksum file in TMP_DIR.
# Fallback path: GitHub release asset digest metadata (sha256) when checksum
# validation fails for any reason.
verify_download_checksum() {
  say "Verify checksum integrity"
  local log="$TMP_DIR/cmd.log"
  local check_cmd=(sha256sum -c "$CHECKSUM_NAME")

  if (cd "$TMP_DIR" && "${check_cmd[@]}") >"$log" 2>&1; then
    ok "Verify checksum integrity"
    return 0
  fi

  warn "Checksum file verification failed; attempting GitHub asset digest fallback."
  echo -e "${C_YELLOW}${C_BOLD}----- CHECKSUM COMMAND OUTPUT BEGIN -----${C_RESET}"
  cat "$log"
  echo -e "${C_YELLOW}${C_BOLD}----- CHECKSUM COMMAND OUTPUT END -----${C_RESET}"

  local jq_expr=".assets[] | select(.name == \"$ASSET_NAME\") | .digest"
  local gh_args=(release view --repo "$REPO" --json assets --jq "$jq_expr")
  if [[ -n "$TAG" ]]; then
    gh_args=(release view "$TAG" --repo "$REPO" --json assets --jq "$jq_expr")
  fi

  local digest_raw=""
  if ! digest_raw="$(gh "${gh_args[@]}" 2>"$log")"; then
    fail "Unable to query GitHub release asset digest metadata."
    echo -e "${C_RED}${C_BOLD}----- COMMAND OUTPUT BEGIN -----${C_RESET}"
    cat "$log"
    echo -e "${C_RED}${C_BOLD}----- COMMAND OUTPUT END -----${C_RESET}"
    exit 1
  fi

  local expected_digest
  expected_digest="$(echo "$digest_raw" | tr -d '\r' | head -n 1)"
  if [[ "$expected_digest" == sha256:* ]]; then
    expected_digest="${expected_digest#sha256:}"
  fi

  if [[ ! "$expected_digest" =~ ^[a-fA-F0-9]{64}$ ]]; then
    fail "GitHub release asset digest metadata is missing or invalid for $ASSET_NAME."
    echo "Received digest value: ${expected_digest:-<empty>}"
    exit 1
  fi

  local actual_digest
  actual_digest="$(sha256sum "$TMP_DIR/$ASSET_NAME" | awk '{print $1}')"

  if [[ "$actual_digest" == "$expected_digest" ]]; then
    ok "Checksum verified via GitHub release asset digest metadata."
    return 0
  fi

  fail "Checksum mismatch after fallback verification."
  echo "Expected (metadata): $expected_digest"
  echo "Actual   (download): $actual_digest"
  exit 1
}

if [[ -n "$TAG" ]]; then
  TAG="$(normalize_tag "$TAG")"
fi

###############################################################################
# PRE-FLIGHT SECTION
# -----------------------------------------------------------------------------
# Validate local tooling and GitHub CLI auth before download/install steps.
###############################################################################
say "Starting quick $MODE for $REPO ${TAG:+($TAG)}"
echo "Service account target: ${SVC_USER}:${SVC_GROUP}"
echo "Install directory: $INSTALL_DIR"

say "Preflight checks"
for c in gh sha256sum tar npm node curl sudo file diff systemctl openssl; do
  check_cmd "$c"
done

# Editor check: nano is preferred; soft-warn if no editor is available at all.
if command -v nano >/dev/null 2>&1; then
  ok "Found preferred editor: nano"
elif [[ -n "${EDITOR:-}" ]] && command -v "${EDITOR}" >/dev/null 2>&1; then
  ok "Found editor (via EDITOR): ${EDITOR}"
elif command -v vi >/dev/null 2>&1; then
  ok "Found fallback editor: vi"
else
  warn "No interactive editor found (nano, vi). Manual editing at review gates will not be available."
fi

# icdiff is optional — preferred for colored upgrade diffs; falls back to diff --color=always.
HAVE_ICDIFF=false
if command -v icdiff >/dev/null 2>&1; then
  HAVE_ICDIFF=true
  ok "Found optional dependency: icdiff"
else
  warn "icdiff not found — diffs will use diff --color=always. Install via your package manager (e.g. sudo apt install icdiff or pip install icdiff)."
fi
run_step "Verify GitHub CLI authentication status" gh auth status

###############################################################################
# DOWNLOAD + INTEGRITY SECTION
# -----------------------------------------------------------------------------
# Pull release assets and verify checksum before extraction.
###############################################################################
say "Download release assets"
DL_ARGS=(release download --repo "$REPO" --pattern "${ASSET_NAME}*"
  --dir "$TMP_DIR" --clobber)
if [[ -n "$TAG" ]]; then
  DL_ARGS=(release download --repo "$REPO" "$TAG" --pattern "${ASSET_NAME}*" --dir "$TMP_DIR" --clobber)
fi
run_step "Download tarball + checksum from GitHub release" gh "${DL_ARGS[@]}"

verify_download_checksum
run_step "Validate archive mime type" bash -lc "file '$TMP_DIR/$ASSET_NAME' | grep -q 'gzip'"

###############################################################################
# EXTRACTION + DEPENDENCY SECTION
# -----------------------------------------------------------------------------
# Install code into /opt, apply ownership, and install production dependencies.
###############################################################################
run_step "Ensure install directory exists" sudo mkdir -p "$INSTALL_DIR"
run_step "Extract release into $INSTALL_DIR" sudo tar -xzf "$TMP_DIR/$ASSET_NAME" -C "$INSTALL_DIR" --strip-components=1
run_step "Set ownership to ${SVC_USER}:${SVC_GROUP}" sudo chown -R "${SVC_USER}:${SVC_GROUP}" "$INSTALL_DIR"
run_step "Install production dependencies" bash -lc "cd '$INSTALL_DIR' && npm ci --omit=dev"

if [[ "$MODE" == "install" ]]; then
  #############################################################################
  # INSTALL MODE SECTION
  # ---------------------------------------------------------------------------
  # - create .env when absent
  # - enforce interactive review gate for .env
  # - install/review systemd service unit
  # - enable/start service
  #############################################################################
  say "Install mode configuration"
  if [[ ! -f "$INSTALL_DIR/.env" ]]; then
    run_step "Create .env from .env.example" cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
  else
    warn ".env already exists; preserving it."
  fi

  configure_tokens

  say "Please review app config before continuing."
  echo "Tip: set PUBLIC_BASE_URL=https://YOUR_HOSTNAME and Arr API keys."
  prompt_gate "Review .env now." "$INSTALL_DIR/.env"

  if [[ ! -f "$SERVICE_PATH" ]]; then
    run_step "Install systemd service template" sudo cp "$INSTALL_DIR/deploy/stremio-addarr.service.example" "$SERVICE_PATH"
  else
    warn "$SERVICE_PATH already exists; preserving current unit file."
  fi

  run_step "Apply service account placeholders in unit file (if present)" sudo sed -i \
    -e "s|YOUR_SVC_USER|$SVC_USER|g" \
    -e "s|YOUR_SVC_GROUP|$SVC_GROUP|g" \
    "$SERVICE_PATH"

  show_step_output "Show service diff vs template" coloured_diff "$INSTALL_DIR/deploy/stremio-addarr.service.example" "$SERVICE_PATH"
  prompt_gate "Review systemd unit file now." "$SERVICE_PATH"

  run_step "Reload systemd" sudo systemctl daemon-reload
  run_step "Enable and start stremio-addarr" sudo systemctl enable --now stremio-addarr
  wait_for_service stremio-addarr || true
else
  #############################################################################
  # UPGRADE MODE SECTION
  # ---------------------------------------------------------------------------
  # - keep existing .env and service if present
  # - show diffs against new templates
  # - require explicit approval/edit gates before restart
  #############################################################################
  say "Upgrade mode review gates"
  if [[ -f "$INSTALL_DIR/.env" ]]; then
    show_step_output "Show .env vs .env.example" coloured_diff "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.example"
    if prompt_confirm "Merge existing .env values into the new .env.example template and replace .env?"; then
      merge_tmp_path="$TMP_DIR/.env.merged"
      run_step "Back up existing .env to .env.backup-before-merge" cp "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.backup-before-merge"
      run_step "Build merged .env from template + existing values" merge_env_with_template "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.example" "$merge_tmp_path"
      run_step "Replace .env with merged template result" cp "$merge_tmp_path" "$INSTALL_DIR/.env"
      show_step_output "Show merged .env vs .env.example (post-merge)" coloured_diff "$INSTALL_DIR/.env" "$INSTALL_DIR/.env.example"
    else
      warn "Skipped .env merge step at operator request."
    fi
    configure_tokens
    prompt_gate "Review .env diff and approve." "$INSTALL_DIR/.env"
  else
    warn "No existing .env found. Creating from .env.example."
    run_step "Create .env from .env.example" cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    configure_tokens
    prompt_gate "Review newly created .env." "$INSTALL_DIR/.env"
  fi

  if [[ -f "$SERVICE_PATH" ]]; then
    show_step_output "Show systemd template vs installed unit diff" coloured_diff "$INSTALL_DIR/deploy/stremio-addarr.service.example" "$SERVICE_PATH"
  else
    warn "No existing service file found. Installing template."
    run_step "Install systemd service template" sudo cp "$INSTALL_DIR/deploy/stremio-addarr.service.example" "$SERVICE_PATH"
  fi
  prompt_gate "Review systemd unit and approve." "$SERVICE_PATH"

  run_step "Reload systemd" sudo systemctl daemon-reload
  run_step "Restart stremio-addarr" sudo systemctl restart stremio-addarr
  wait_for_service stremio-addarr || true
fi

if [[ "$SKIP_TRAKT" == "false" ]]; then
  configure_trakt_oauth
fi
load_env_file

###############################################################################
# VERIFICATION SECTION
# -----------------------------------------------------------------------------
# Confirm service health and local/public manifest reachability.
# Public manifest can warn when reverse-proxy/DNS/TLS is not yet finalized.
###############################################################################
say "Verification checks..."
sleep 3
if systemctl is-active --quiet stremio-addarr; then
  print_status_line OK "systemd reports stremio-addarr is active."
else
  print_status_line FAIL "systemd does not report active service."
  VERIFICATION_FAILURES=$((VERIFICATION_FAILURES + 1))
  VERIFY_ERRORS+=("systemd does not report stremio-addarr as active")
  say "Show recent service logs"
  cmd "sudo journalctl -u stremio-addarr -n 80 --no-pager"
  sudo journalctl -u stremio-addarr -n 80 --no-pager || true
fi

PUBLIC_MANIFEST_URL=""
PUBLIC_CONFIGURE_URL=""
if [[ -z "${PUBLIC_BASE_URL:-}" ]]; then
  print_status_line WARN "PUBLIC_BASE_URL is missing in .env. Configure hosting before Stremio install."
elif [[ -z "${ADDON_ACCESS_TOKEN:-}" ]]; then
  print_status_line FAIL "ADDON_ACCESS_TOKEN is missing in .env."
  VERIFICATION_FAILURES=$((VERIFICATION_FAILURES + 1))
  VERIFY_ERRORS+=("ADDON_ACCESS_TOKEN is missing")
else
  PUBLIC_MANIFEST_URL="${PUBLIC_BASE_URL%/}/${ADDON_ACCESS_TOKEN}/manifest.json"
  PUBLIC_CONFIGURE_URL="${PUBLIC_BASE_URL%/}/${ADDON_ACCESS_TOKEN}/configure"
  run_verification "Public health endpoint responds." curl -fsS "${PUBLIC_BASE_URL%/}/healthz"
  run_verification "Public protected manifest endpoint responds." curl -fsS "$PUBLIC_MANIFEST_URL"
  run_verification "Public status.json endpoint responds." curl -fsS "${PUBLIC_BASE_URL%/}/status.json"
  if [[ "${CONFIG_UI_ENABLED:-false}" == "true" ]]; then
    run_verification "Public token-derived Configure page responds." curl -fsS "$PUBLIC_CONFIGURE_URL"
  fi
fi

run_verification "Local health endpoint responds." curl -fsS http://127.0.0.1:7010/healthz
if [[ -n "${ADDON_ACCESS_TOKEN:-}" ]]; then
  run_verification "Local protected manifest endpoint responds." curl -fsS "http://127.0.0.1:7010/${ADDON_ACCESS_TOKEN}/manifest.json"
  if [[ "${CONFIG_UI_ENABLED:-false}" == "true" ]]; then
    run_verification "Local token-derived Configure page responds." curl -fsS "http://127.0.0.1:7010/${ADDON_ACCESS_TOKEN}/configure"
  fi
fi
run_verification "Local status.json endpoint responds." curl -fsS http://127.0.0.1:7010/status.json

echo
echo -e "${C_BLUE}${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
if (( VERIFICATION_FAILURES == 0 )); then
  echo -e "  ${C_GREEN}${C_BOLD}${MODE^^} SUCCESSFUL${C_RESET}"
else
  echo -e "  ${C_YELLOW}${C_BOLD}${MODE^^} COMPLETED WITH ${VERIFICATION_FAILURES} VERIFICATION ERROR(S)${C_RESET}"
fi
echo -e "${C_BLUE}${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"
echo
echo -e "  ${C_BOLD}Mode:${C_RESET}         $MODE"
echo -e "  ${C_BOLD}Install path:${C_RESET} $INSTALL_DIR"
echo -e "  ${C_BOLD}Env file:${C_RESET}     $INSTALL_DIR/.env"
echo
echo -e "  ${C_BOLD}Quick commands:${C_RESET}"
echo "    sudo systemctl restart stremio-addarr"
echo "    sudo systemctl status  stremio-addarr --no-pager -l"
echo "    sudo journalctl -u stremio-addarr -f"
if [[ -n "${PUBLIC_MANIFEST_URL:-}" ]]; then
  echo
  echo -e "  ${C_BOLD}Stremio manifest:${C_RESET}  $PUBLIC_MANIFEST_URL"
  echo "  Paste this exact protected URL into Stremio."
  echo "  The unprotected /manifest.json URL intentionally returns 404."
  if [[ "${CONFIG_UI_ENABLED:-false}" == "true" ]]; then
    echo -e "  ${C_BOLD}Configure page:${C_RESET}    $PUBLIC_CONFIGURE_URL"
    echo "  Save server settings there; reinstall only after first setup or an access-token change."
  fi
fi
if (( VERIFICATION_FAILURES > 0 )); then
  echo
  echo -e "  ${C_YELLOW}${C_BOLD}ERRORS — ${VERIFICATION_FAILURES} VERIFICATION FAILURE(S) (see above for details):${C_RESET}"
  for err in "${VERIFY_ERRORS[@]}"; do
    echo -e "  ${C_RED}${C_BOLD}  • ${err}${C_RESET}"
  done
  echo
  echo -e "  ${C_YELLOW}${C_BOLD}Try restarting before troubleshooting further:${C_RESET}"
  echo "    sudo systemctl restart stremio-addarr"
  echo "    sudo systemctl status  stremio-addarr --no-pager -l"
fi
echo
warn "If hosting/TLS changed, re-run README_HOST.md and then re-run: bash quick.sh $MODE"
echo -e "${C_BLUE}${C_BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C_RESET}"

###############################################################################
# END OF SCRIPT
###############################################################################
