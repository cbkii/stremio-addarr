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
  bash quick.sh upgrade [--repo owner/name] [--tag vX.Y.Z] [--svc-user USER] [--svc-group GROUP]

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

# Parse optional flags (repo/tag/service account overrides).
while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tag) TAG="$2"; shift 2 ;;
    --svc-user) SVC_USER="$2"; shift 2 ;;
    --svc-group) SVC_GROUP="$2"; shift 2 ;;
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

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Helper: run one named step, capture output, and show a clear failure block.
run_step() {
  local desc="$1"; shift
  local log="$TMP_DIR/cmd.log"
  say "$desc"
  echo "Command: $*"
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

# Helper: approval gate (y=proceed, n=open file in nano, then re-prompt).
prompt_gate() {
  local title="$1"
  local edit_file="$2"
  while true; do
    echo
    echo -e "${C_BOLD}${title}${C_RESET}"
    read -r -p "Approve and continue? [y] yes / [n] stop and edit with nano: " ans
    case "${ans,,}" in
      y|yes)
        ok "Approved by operator."
        break
        ;;
      n|no)
        if [[ -n "$edit_file" ]]; then
          run_step "Open $edit_file in nano for manual edits" nano "$edit_file"
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

# Helper: normalize semver tag input so 1.2.3 and v1.2.3 behave the same.
normalize_tag() {
  local t="$1"
  if [[ "$t" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.].*)?$ ]]; then
    echo "v$t"
  else
    echo "$t"
  fi
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
for c in gh sha256sum tar npm curl sudo file diff nano systemctl; do
  check_cmd "$c"
done
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

run_step "Verify checksum integrity" sha256sum -c "$TMP_DIR/$CHECKSUM_NAME"
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

  run_step "Show service diff vs template" bash -lc "diff -u '$INSTALL_DIR/deploy/stremio-addarr.service.example' '$SERVICE_PATH' || true"
  prompt_gate "Review systemd unit file now." "$SERVICE_PATH"

  run_step "Reload systemd" sudo systemctl daemon-reload
  run_step "Enable and start stremio-addarr" sudo systemctl enable --now stremio-addarr
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
    run_step "Show .env.example vs existing .env diff" bash -lc "cd '$INSTALL_DIR' && diff -u .env.example .env || true"
    prompt_gate "Review .env diff and approve." "$INSTALL_DIR/.env"
  else
    warn "No existing .env found. Creating from .env.example."
    run_step "Create .env from .env.example" cp "$INSTALL_DIR/.env.example" "$INSTALL_DIR/.env"
    prompt_gate "Review newly created .env." "$INSTALL_DIR/.env"
  fi

  if [[ -f "$SERVICE_PATH" ]]; then
    run_step "Show systemd template vs installed unit diff" bash -lc "cd '$INSTALL_DIR' && diff -u deploy/stremio-addarr.service.example '$SERVICE_PATH' || true"
  else
    warn "No existing service file found. Installing template."
    run_step "Install systemd service template" sudo cp "$INSTALL_DIR/deploy/stremio-addarr.service.example" "$SERVICE_PATH"
  fi
  prompt_gate "Review systemd unit and approve." "$SERVICE_PATH"

  run_step "Reload systemd" sudo systemctl daemon-reload
  run_step "Restart stremio-addarr" sudo systemctl restart stremio-addarr
fi

###############################################################################
# VERIFICATION SECTION
# -----------------------------------------------------------------------------
# Confirm service health and local/public manifest reachability.
# Public manifest can warn when reverse-proxy/DNS/TLS is not yet finalized.
###############################################################################
say "Verification checks"
if systemctl is-active --quiet stremio-addarr; then
  print_status_line OK "systemd reports stremio-addarr is active."
else
  print_status_line FAIL "systemd does not report active service."
  run_step "Show recent service logs" sudo journalctl -u stremio-addarr -n 80 --no-pager
fi

if curl -fsS http://127.0.0.1:7010/healthz >/dev/null; then
  print_status_line OK "Local health endpoint responds."
else
  print_status_line FAIL "Local health endpoint failed."
  run_step "Fetch local health endpoint for diagnostics" curl -v http://127.0.0.1:7010/healthz
fi

if curl -fsS http://127.0.0.1:7010/manifest.json >/dev/null; then
  print_status_line OK "Local manifest endpoint responds."
else
  print_status_line FAIL "Local manifest endpoint failed."
  run_step "Fetch local manifest for diagnostics" curl -v http://127.0.0.1:7010/manifest.json
fi

set +u
source "$INSTALL_DIR/.env"
set -u

if [[ -z "${PUBLIC_BASE_URL:-}" ]]; then
  print_status_line WARN "PUBLIC_BASE_URL is missing in .env. Configure hosting before Stremio install."
else
  if curl -fI "${PUBLIC_BASE_URL}/manifest.json" >/dev/null; then
    print_status_line OK "Public HTTPS manifest endpoint responds."
  else
    print_status_line WARN "Public HTTPS manifest check failed. Usually Caddy/DNS/TLS still needs setup."
  fi
  echo
  echo -e "${C_GREEN}${C_BOLD}Install URL:${C_RESET} ${PUBLIC_BASE_URL}/manifest.json"
  echo "Paste this exact URL into Stremio: ${PUBLIC_BASE_URL}/manifest.json"
fi

echo
ok "Quick $MODE flow completed."
warn "If hosting/TLS changed, re-run README_HOST.md and then re-run: bash quick.sh $MODE"

###############################################################################
# END OF SCRIPT
###############################################################################
