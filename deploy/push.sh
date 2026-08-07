#!/usr/bin/env bash
# Deploy the tracked HA config to the prod HAOS box over SSH, then reload or
# restart as needed. This is the externalized form of the container entrypoint's
# staging (see deploy/PLAN.md) — the box can't run our entrypoint, so we push.
#
#   deploy/push.sh [--render-config] [--restart|--reload|--no-reload]
#                  [--skip-components] [--dry-run]
#
# What it syncs (over the SSH add-on, to $REMOTE_CONFIG, default /config):
#   • configuration.yaml, packages/, blueprints/automation/heater_control/
#   • custom_components/* — the pinned+patched auth_oidc (and, once it exists,
#     the schedulemaster integration), each materialized into a staging dir first
#   • http.yaml / auth_oidc.yaml — only with --render-config (from deploy/.env)
#
# Then it picks the lightest action (auto by default):
#   • YAML-only change ....................... homeassistant.reload_all (hot)
#   • custom_components / includes changed ... ha core restart (Python needs it)
#   • nothing changed ........................ no-op
# A core config check runs before any restart; a failure aborts before restart.
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(cd "$(dirname "$0")" && pwd)/lib/common.sh"
load_env

usage() {
  cat >&2 <<'EOF'
usage: deploy/push.sh [options]

  --render-config   also render + push http.yaml/auth_oidc.yaml from deploy/.env
                    (required on the first push)
  --restart         force a core restart regardless of what changed
  --reload          force reload_all regardless of what changed
  --no-reload       sync only; take no reload/restart action
  --skip-components  don't touch custom_components (faster YAML-only deploys)
  --dry-run         show what rsync would transfer + the action, change nothing

env (deploy/.env): HA_URL, HA_TOKEN, SSH_TARGET, [SSH_PORT=22], [REMOTE_CONFIG=/config],
                   [SSH_OPTS], plus OIDC_*/HA_CORS_ORIGINS/... for --render-config
EOF
  exit 1
}

RENDER_CONFIG=0
DRYRUN=0
SKIP_COMPONENTS=0
FORCE_ACTION=""
while [ $# -gt 0 ]; do
  case "$1" in
    --render-config) RENDER_CONFIG=1 ;;
    --restart) FORCE_ACTION="restart" ;;
    --reload) FORCE_ACTION="reload" ;;
    --no-reload) FORCE_ACTION="none" ;;
    --skip-components) SKIP_COMPONENTS=1 ;;
    --dry-run) DRYRUN=1 ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1" ;;
  esac
  shift
done

require HA_URL HA_TOKEN SSH_TARGET
SSH_PORT="${SSH_PORT:-22}"
REMOTE_CONFIG="${REMOTE_CONFIG:-/config}"
SSH_CMD="ssh -p ${SSH_PORT} ${SSH_OPTS:-}"
HA_SRC="$REPO_ROOT/homeassistant"

# Fail fast on a bad token/URL before staging + syncing.
ha_preflight

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# --- stage custom_components (materialize the patched auth_oidc) ---
if [ "$SKIP_COMPONENTS" -eq 0 ]; then
  mkdir -p "$STAGE/custom_components"
  materialize_auth_oidc "$STAGE/custom_components/auth_oidc"
  # Repo-tracked components (e.g. the future schedulemaster integration).
  if [ -d "$HA_SRC/custom_components" ]; then
    cp -R "$HA_SRC/custom_components/." "$STAGE/custom_components/"
  fi
fi

# --- stage env-rendered includes ---
if [ "$RENDER_CONFIG" -eq 1 ]; then
  command -v python3 >/dev/null || die "python3 required for --render-config"
  HA_CONFIG_DIR="$STAGE" python3 "$DEPLOY_DIR/lib/render_config.py"
fi

RSYNC_BASE=(-rlt -i --out-format='%i %n')
[ "$DRYRUN" -eq 1 ] && RSYNC_BASE+=(--dry-run)

needs_reload=0
needs_restart=0

# sync LABEL SRC DEST_REL [extra rsync args...] — returns 0 if anything changed.
sync() {
  local label="$1" src="$2" dest="$3"
  shift 3
  local out
  out="$(rsync "${RSYNC_BASE[@]}" "$@" -e "$SSH_CMD" "$src" "$SSH_TARGET:$REMOTE_CONFIG/$dest")" ||
    die "rsync failed: $label"
  if printf '%s\n' "$out" | grep -qE '^(\*deleting|[<>ch])'; then
    info "changed: $label"
    printf '%s\n' "$out" | grep -E '^(\*deleting|[<>ch])' | sed 's/^/    /' >&2
    return 0
  fi
  return 1
}

# rsync won't create missing PARENT dirs of a destination. HA scaffolds
# blueprints/automation at onboarding but not packages/ or custom_components/, so
# pre-create them (idempotent) — else rsync dies with "mkdir ... No such file or
# directory" the first time. Harmless on a dry-run (empty dirs HA ignores).
# shellcheck disable=SC2086
ssh -p "$SSH_PORT" ${SSH_OPTS:-} "$SSH_TARGET" \
  "mkdir -p '$REMOTE_CONFIG/packages' '$REMOTE_CONFIG/blueprints/automation' '$REMOTE_CONFIG/custom_components'" ||
  die "couldn't create remote directories under $REMOTE_CONFIG"

# YAML config — we fully own packages/ and the heater_control blueprint dir, so
# --delete there prunes removed heaters/blueprints. configuration.yaml is a lone
# file (no delete). Never --delete at /config root or custom_components root.
sync "configuration.yaml" "$HA_SRC/configuration.yaml" "configuration.yaml" && needs_reload=1
sync "packages/" "$HA_SRC/packages/" "packages/" --delete && needs_reload=1
sync "blueprints/heater_control" \
  "$HA_SRC/blueprints/automation/heater_control/" \
  "blueprints/automation/heater_control/" --delete && needs_reload=1

# custom_components — per component dir, so --delete stays scoped inside a
# component we own (won't touch HACS or unrelated integrations on the box).
if [ "$SKIP_COMPONENTS" -eq 0 ]; then
  for comp in "$STAGE"/custom_components/*/; do
    [ -d "$comp" ] || continue
    name="$(basename "$comp")"
    sync "custom_components/$name" "$comp" "custom_components/$name/" --delete && needs_restart=1
  done
fi

# Env includes changed -> restart (http/auth_oidc are read at startup).
if [ "$RENDER_CONFIG" -eq 1 ]; then
  sync "http.yaml" "$STAGE/http.yaml" "http.yaml" && needs_restart=1
  sync "auth_oidc.yaml" "$STAGE/auth_oidc.yaml" "auth_oidc.yaml" && needs_restart=1
fi

# --- decide action ---
if [ -n "$FORCE_ACTION" ]; then
  action="$FORCE_ACTION"
elif [ "$needs_restart" -eq 1 ]; then
  action="restart"
elif [ "$needs_reload" -eq 1 ]; then
  action="reload"
else
  action="none"
fi

if [ "$DRYRUN" -eq 1 ]; then
  info "dry-run: would ${action}"
  exit 0
fi

case "$action" in
  none)
    info "no changes to apply"
    ;;
  reload)
    info "reloading config (homeassistant.reload_all)"
    ha_curl POST /api/services/homeassistant/reload_all '{}' >/dev/null
    info "reloaded"
    ;;
  restart)
    info "checking config before restart"
    res="$(ha_curl POST /api/config/core/check_config '{}')"
    # Gate on ERRORS (fatal), not result==valid. A freshly-pushed custom_component
    # isn't loaded in the running instance yet, so it shows up as a non-fatal
    # WARNING ("Integration 'x' not found") that the restart itself resolves —
    # blocking on it would make the first deploy of any integration impossible.
    errors="$(printf '%s' "$res" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("errors") or "").strip())')" ||
      die "couldn't parse config check response: $res"
    warnings="$(printf '%s' "$res" | python3 -c 'import json,sys; print((json.load(sys.stdin).get("warnings") or "").strip())')"
    [ -n "$warnings" ] && info "config check warnings (non-fatal): $warnings"
    [ -z "$errors" ] || die "config check FAILED, not restarting: $errors"
    info "config OK; restarting HA core"
    # The restart tears down the HTTP server mid-response, so a dropped
    # connection here is expected, not a failure.
    ha_curl POST /api/services/homeassistant/restart '{}' >/dev/null 2>&1 || true
    info "restart requested"
    ;;
  *) die "unknown action: $action" ;;
esac
