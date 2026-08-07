#!/usr/bin/env bash
# Push ongoing config updates to the (hand-provisioned) prod HAOS box over SSH,
# then apply them with the lightest action. Scope is the config that iterates:
#   • packages/ (heaters + their automations) and the heater_control blueprint
#   • repo-tracked custom_components/ (e.g. the schedulemaster integration)
#
# The box's set-once pieces stay by-hand and are never touched: onboarding,
# add-ons, configuration.yaml, the http/auth_oidc includes, and the hand-installed
# auth_oidc component (not in the repo, so it's never synced or deleted).
#
#   deploy/push.sh [--dry-run] [--no-apply]
#
# Apply action, chosen from what changed:
#   • YAML only (packages/blueprints) ..... homeassistant.reload_all  (hot)
#   • custom_components changed ........... ha core restart (Python needs it)
#   • nothing changed .................... no-op
# A config check runs before any restart and aborts it on errors.
#
# Config via deploy/.env (see .env.example): HA_URL, HA_TOKEN, SSH_TARGET, and
# optional SSH_PORT / REMOTE_CONFIG / SSH_OPTS.
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
HA_SRC="$REPO_ROOT/homeassistant"

die() {
  echo "error: $*" >&2
  exit 1
}
info() { echo "[deploy] $*" >&2; }

# Load deploy/.env if present.
if [ -f "$DEPLOY_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DEPLOY_DIR/.env"
  set +a
fi

DRYRUN=0
APPLY=1
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRYRUN=1 ;;
    --no-apply | --no-reload) APPLY=0 ;; # --no-reload kept as an alias
    -h | --help)
      echo "usage: deploy/push.sh [--dry-run] [--no-apply]" >&2
      exit 1
      ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

for v in HA_URL HA_TOKEN SSH_TARGET; do
  [ -n "${!v:-}" ] || die "$v is required (set it in deploy/.env)"
done
SSH_PORT="${SSH_PORT:-22}"
REMOTE_CONFIG="${REMOTE_CONFIG:-/config}"
SSH_CMD="ssh -p ${SSH_PORT} ${SSH_OPTS:-}"

# ha_curl METHOD PATH [json] — core REST with the bearer token.
ha_curl() {
  curl -fsS -X "$1" \
    -H "Authorization: Bearer ${HA_TOKEN}" -H "Content-Type: application/json" \
    "${HA_URL%/}$2" ${3:+-d "$3"}
}

# Preflight: fail clearly on a bad token/URL before syncing. Probes core /api/;
# the Supervisor proxy is not used.
code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${HA_TOKEN}" "${HA_URL%/}/api/" 2>/dev/null)" ||
  die "can't reach HA at ${HA_URL} (connection failed — check HA_URL / network / Tailscale)"
case "$code" in
  200) info "preflight: HA reachable and token accepted" ;;
  401 | 403) die "HA rejected the token (${code}) — check HA_TOKEN (long-lived token, Profile -> Security)" ;;
  000) die "no response from ${HA_URL} — check HA_URL / network / Tailscale" ;;
  *) die "unexpected HTTP ${code} from ${HA_URL%/}/api/ — check HA_URL" ;;
esac

# rsync won't create missing PARENT dirs. HA scaffolds blueprints/automation but
# not packages/ or custom_components/, so pre-create them (idempotent; skipped on
# a dry-run).
if [ "$DRYRUN" -eq 0 ]; then
  # shellcheck disable=SC2086
  ssh -p "$SSH_PORT" ${SSH_OPTS:-} "$SSH_TARGET" \
    "mkdir -p '$REMOTE_CONFIG/packages' '$REMOTE_CONFIG/blueprints/automation' '$REMOTE_CONFIG/custom_components'" ||
    die "couldn't create remote directories under $REMOTE_CONFIG"
fi

RSYNC=(-rlt -i --out-format='%i %n' --delete)
[ "$DRYRUN" -eq 1 ] && RSYNC+=(--dry-run)

# sync LABEL SRC DEST_REL — returns 0 if anything transferred. --delete is safe
# because every DEST is a dir we fully own (packages/, the heater_control dir, or
# a single custom_component dir — never custom_components/ root, so the box's
# hand-installed auth_oidc and any HACS installs are untouched).
sync() {
  local label="$1" src="$2" dest="$3" out
  out="$(rsync "${RSYNC[@]}" -e "$SSH_CMD" "$src" "$SSH_TARGET:$REMOTE_CONFIG/$dest")" ||
    die "rsync failed: $label"
  if printf '%s\n' "$out" | grep -qE '^(\*deleting|[<>ch])'; then
    info "changed: $label"
    printf '%s\n' "$out" | grep -E '^(\*deleting|[<>ch])' | sed 's/^/    /' >&2
    return 0
  fi
  return 1
}

needs_reload=0
needs_restart=0

if sync "packages/" "$HA_SRC/packages/" "packages/"; then needs_reload=1; fi
if sync "blueprints/heater_control" \
  "$HA_SRC/blueprints/automation/heater_control/" \
  "blueprints/automation/heater_control/"; then needs_reload=1; fi

# Repo-tracked custom_components, one dir at a time (so --delete stays scoped
# inside a component we own). No-op until homeassistant/custom_components/ exists.
if [ -d "$HA_SRC/custom_components" ]; then
  for comp in "$HA_SRC"/custom_components/*/; do
    [ -d "$comp" ] || continue # non-nullglob guard when the dir is empty
    name="$(basename "$comp")"
    if sync "custom_components/$name" "$comp" "custom_components/$name/"; then needs_restart=1; fi
  done
fi

# --- decide action ---
if [ "$APPLY" -eq 0 ]; then
  action="none-forced"
elif [ "$needs_restart" -eq 1 ]; then
  action="restart"
elif [ "$needs_reload" -eq 1 ]; then
  action="reload"
else
  action="none"
fi

if [ "$DRYRUN" -eq 1 ]; then
  case "$action" in
    restart) info "dry-run: would restart HA core" ;;
    reload) info "dry-run: would reload_all" ;;
    none-forced) info "dry-run: would sync only (--no-apply)" ;;
    *) info "dry-run: no changes" ;;
  esac
  exit 0
fi

case "$action" in
  none) info "no changes to apply" ;;
  none-forced) info "changes synced; no reload/restart (--no-apply)" ;;
  reload)
    info "reloading config (homeassistant.reload_all)"
    ha_curl POST /api/services/homeassistant/reload_all '{}' >/dev/null || die "reload_all failed"
    info "reloaded"
    ;;
  restart)
    info "checking config before restart"
    res="$(ha_curl POST /api/config/core/check_config '{}')"
    # Gate on ERRORS (fatal), not result==valid: a freshly-pushed custom_component
    # isn't loaded in the running instance yet, so it shows up as a non-fatal
    # WARNING ("Integration 'x' not found") that the restart itself resolves.
    errors="$(printf '%s' "$res" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("errors") or "").strip())')" ||
      die "couldn't parse config check response: $res"
    warnings="$(printf '%s' "$res" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("warnings") or "").strip())')"
    [ -n "$warnings" ] && info "config check warnings (non-fatal): $warnings"
    [ -z "$errors" ] || die "config check FAILED, not restarting: $errors"
    info "config OK; restarting HA core (it will be briefly unavailable)"
    # The restart tears down the HTTP server mid-response, so a dropped
    # connection here is expected, not a failure.
    ha_curl POST /api/services/homeassistant/restart '{}' >/dev/null 2>&1 || true
    info "restart requested"
    ;;
esac
