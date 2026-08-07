#!/usr/bin/env bash
# One-time first-run provisioning for the prod HAOS box. Idempotent — safe to
# re-run (it's how you continue after creating the long-lived token).
#
#   deploy/bootstrap.sh [--skip-onboard]
#
# Flow (see deploy/PLAN.md, Goal 1):
#   1. Onboard the owner account + calendar/location/weather via provision.py
#      (REST; no token needed — works against a fresh box on the LAN).
#   2. Check SSH reachability. The SSH add-on itself is a one-time MANUAL UI
#      install (the Supervisor API rejects user tokens) — if SSH isn't up yet,
#      the script prints exactly what to install and stops.
#   3. Once SSH works, hand off to push.sh for the first config push.
#
# On the very first run HA_TOKEN won't exist yet: step 1 runs, then the script
# prints how to mint the token and stops. Set HA_TOKEN + SSH_TARGET in deploy/.env
# and re-run to finish steps 2–3.
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"
load_env

SKIP_ONBOARD=0
while [ $# -gt 0 ]; do
  case "$1" in
    --skip-onboard) SKIP_ONBOARD=1 ;;
    -h | --help)
      echo "usage: deploy/bootstrap.sh [--skip-onboard]" >&2
      exit 1
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

require HA_URL

# --- Step 1: onboarding ---
if [ "$SKIP_ONBOARD" -eq 0 ]; then
  # Guard against silently creating the dev/dev owner on a prod box.
  require HA_ONBOARD_USERNAME HA_ONBOARD_PASSWORD
  info "onboarding + baseline config via provision.py"
  python3 "$DEPLOY_DIR/lib/provision.py"
fi

# --- Step 2 needs a token ---
if [ -z "${HA_TOKEN:-}" ]; then
  cat >&2 <<EOF

[deploy] Onboarding done. To finish, mint an access token:
  1. Open ${HA_URL} and sign in as ${HA_ONBOARD_USERNAME:-your owner}.
  2. Profile -> Security -> Long-lived access tokens -> Create Token.
  3. Add it to deploy/.env as HA_TOKEN (and set SSH_TARGET + a public key).
  4. Re-run: deploy/bootstrap.sh --skip-onboard
EOF
  exit 0
fi

# Resolve the SSH public key (best-effort — used to print paste-ready output).
resolve_pubkey() {
  if [ -n "${SSH_AUTHORIZED_KEY:-}" ]; then
    printf '%s' "$SSH_AUTHORIZED_KEY"
    return
  fi
  local f="${SSH_PUBKEY_FILE:-}"
  if [ -z "$f" ]; then
    for c in ~/.ssh/id_ed25519.pub ~/.ssh/id_rsa.pub; do
      [ -f "$c" ] && f="$c" && break
    done
  fi
  [ -n "$f" ] && [ -f "$f" ] && cat "$f"
}

# --- Step 2: SSH add-on (one-time, MANUAL) ---
# The Supervisor API (/api/hassio) rejects HA long-lived access tokens — they
# authenticate core /api but not the Supervisor proxy (verified against a real
# box: /api/ -> 200, /api/hassio/... -> 401). The Supervisor API is meant to be
# called by add-ons with a SUPERVISOR_TOKEN, not by outside tooling. So the SSH
# add-on — the transport everything else rides on — is installed once by hand.
# Everything after it (config push, reload/restart) uses core /api, which the
# token DOES authorize.
SSH_PORT="${SSH_PORT:-22}"

ssh_ok() {
  [ -n "${SSH_TARGET:-}" ] || return 1
  # shellcheck disable=SC2086
  ssh -p "$SSH_PORT" ${SSH_OPTS:-} -o BatchMode=yes -o ConnectTimeout=5 \
    "$SSH_TARGET" true 2>/dev/null
}

if ! ssh_ok; then
  pubkey="$(resolve_pubkey || true)"
  cat >&2 <<'EOF'

[deploy] Can't SSH in yet — install the SSH add-on once via the HA UI:
  Settings -> Add-ons -> Add-on store -> "Advanced SSH & Web Terminal"
    • Configuration -> authorized_keys: add your public key (below)
    • Configuration -> packages: add  rsync  (the deploy needs it on the box)
    • Start the add-on, and enable "Start on boot".
  Then check where HA's config is mounted (recent add-ons use /homeassistant,
  not /config) and set REMOTE_CONFIG + SSH_TARGET in deploy/.env to match.
EOF
  if [ -n "$pubkey" ]; then
    printf '\n  your public key:\n    %s\n' "$pubkey" >&2
  fi
  echo "" >&2
  echo "  ...then re-run: deploy/bootstrap.sh --skip-onboard" >&2
  exit 0
fi

info "SSH to $SSH_TARGET OK"

# --- Step 3: first config push ---
info "running first config push"
"$DEPLOY_DIR/push.sh" --render-config --restart
info "bootstrap complete"
