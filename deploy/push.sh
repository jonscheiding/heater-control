#!/usr/bin/env bash
# Push config updates to the (hand-provisioned) prod HAOS box over SSH, then
# apply them with the lightest action.
#
#   deploy/push.sh [--dry-run] [--no-apply] [--oidc] [--calendar]
#
# Default scope — the config that iterates:
#   • packages/ (heaters + their automations) and the heater_control blueprint
#   • repo-tracked custom_components/ (e.g. the schedulemaster integration)
#
# --oidc — the set-once OIDC bundle (run at setup, or to bump the pinned version
# / rotate the secret / change CORS):
#   • materialize the pinned + PATCHED auth_oidc component and ship it (the patch
#     is the "Continue on this device" fix in homeassistant/patches/)
#   • render auth_oidc.yaml + http.yaml from .env and ship them (you keep the
#     `auth_oidc: !include auth_oidc.yaml` / `http: !include http.yaml` lines in
#     configuration.yaml by hand)
#   • upsert sm_oidc_client_secret into the box's secrets.yaml (auth_oidc.yaml
#     references it via !secret), preserving your other secrets
#
# --calendar — ensure the "Heater schedules" local_calendar config entry exists
# (entity calendar.heater_schedules, which the scheduling package + SPA hard-code).
# One-time, idempotent; a config entry, not YAML, so it can't live in a package.
#
# Apply action, from what changed: YAML (packages/blueprints) -> reload_all (hot);
# custom_components / includes / secret -> core restart (gated on a config check);
# nothing -> no-op. The box's other set-once pieces (onboarding, add-ons,
# configuration.yaml itself) stay by-hand.
#
# Config via deploy/.env (see .env.example).
set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"
HA_SRC="$REPO_ROOT/homeassistant"
AUTH_OIDC_VERSION="${AUTH_OIDC_VERSION:-v1.1.1}" # keep in sync with ha-dev/Dockerfile

die() {
  echo "error: $*" >&2
  exit 1
}
info() { echo "[deploy] $*" >&2; }

if [ -f "$DEPLOY_DIR/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "$DEPLOY_DIR/.env"
  set +a
fi

DRYRUN=0
APPLY=1
OIDC=0
CALENDAR=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) DRYRUN=1 ;;
    --no-apply | --no-reload) APPLY=0 ;; # --no-reload kept as an alias
    --oidc) OIDC=1 ;;
    --calendar) CALENDAR=1 ;;
    -h | --help)
      echo "usage: deploy/push.sh [--dry-run] [--no-apply] [--oidc] [--calendar]" >&2
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

# shellcheck disable=SC2086
ssh_run() { ssh -p "$SSH_PORT" ${SSH_OPTS:-} "$SSH_TARGET" "$@"; }

ha_curl() {
  curl -fsS -X "$1" \
    -H "Authorization: Bearer ${HA_TOKEN}" -H "Content-Type: application/json" \
    "${HA_URL%/}$2" ${3:+-d "$3"}
}

# Fetch the pinned auth_oidc release and overlay our patch — same as
# ha-dev/Dockerfile, stdlib-only so it runs anywhere python3 is present.
materialize_auth_oidc() {
  local dest="$1" url tmpzip
  url="https://github.com/christiaangoossens/hass-oidc-auth/releases/download/${AUTH_OIDC_VERSION}/hass-oidc-auth.zip"
  tmpzip="$(mktemp)"
  info "fetching auth_oidc ${AUTH_OIDC_VERSION}"
  python3 - "$url" "$tmpzip" <<'PY'
import sys, urllib.request
req = urllib.request.Request(sys.argv[1], headers={"User-Agent": "heater-control-deploy"})
open(sys.argv[2], "wb").write(urllib.request.urlopen(req).read())
PY
  mkdir -p "$dest"
  python3 -m zipfile -e "$tmpzip" "$dest"
  rm -f "$tmpzip"
  cp -R "$REPO_ROOT/homeassistant/patches/auth_oidc/." "$dest/"
}

# Preflight: fail clearly on a bad token/URL before doing anything. Probes core
# /api/; the Supervisor proxy is not used.
code="$(curl -s -o /dev/null -w '%{http_code}' \
  -H "Authorization: Bearer ${HA_TOKEN}" "${HA_URL%/}/api/" 2>/dev/null)" ||
  die "can't reach HA at ${HA_URL} (connection failed — check HA_URL / network / Tailscale)"
case "$code" in
  200) info "preflight: HA reachable and token accepted" ;;
  401 | 403) die "HA rejected the token (${code}) — check HA_TOKEN (long-lived token, Profile -> Security)" ;;
  000) die "no response from ${HA_URL} — check HA_URL / network / Tailscale" ;;
  *) die "unexpected HTTP ${code} from ${HA_URL%/}/api/ — check HA_URL" ;;
esac

STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT

# --- stage the OIDC bundle (component + rendered includes) ---
if [ "$OIDC" -eq 1 ]; then
  [ -n "${OIDC_CLIENT_SECRET:-}" ] || die "--oidc needs OIDC_CLIENT_SECRET in deploy/.env"
  mkdir -p "$STAGE/custom_components"
  materialize_auth_oidc "$STAGE/custom_components/auth_oidc"
  HA_CONFIG_DIR="$STAGE" python3 "$DEPLOY_DIR/render_includes.py"
fi

# rsync won't create missing PARENT dirs. HA scaffolds blueprints/automation but
# not packages/ or custom_components/, so pre-create them (idempotent; not on dry-run).
if [ "$DRYRUN" -eq 0 ]; then
  ssh_run "mkdir -p '$REMOTE_CONFIG/packages' '$REMOTE_CONFIG/blueprints/automation' '$REMOTE_CONFIG/custom_components'" ||
    die "couldn't create remote directories under $REMOTE_CONFIG"
fi

RSYNC=(-rlt -i --out-format='%i %n' --delete)
[ "$DRYRUN" -eq 1 ] && RSYNC+=(--dry-run)

# sync LABEL SRC DEST_REL — returns 0 if anything transferred. --delete is safe:
# every DEST is a dir we fully own, or a lone file (where --delete is a no-op) —
# never custom_components/ root, so the box's other components are untouched.
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

# Upsert sm_oidc_client_secret in the box's secrets.yaml, preserving other keys.
# Returns 0 if it changed (or would, on a dry-run).
manage_oidc_secret() {
  local key="sm_oidc_client_secret" cur new
  cur="$(ssh_run "cat '$REMOTE_CONFIG/secrets.yaml' 2>/dev/null || true")"
  # Pass the current file via env, not stdin: `python3 - <<'PY'` already consumes
  # stdin for the program, so a piped-in secrets.yaml would be lost (and we'd
  # clobber the user's other secrets).
  new="$(CUR="$cur" SECRET_KEY="$key" SECRET_VAL="$OIDC_CLIENT_SECRET" python3 - <<'PY'
import os, sys
key, val = os.environ["SECRET_KEY"], os.environ["SECRET_VAL"]
lines = os.environ["CUR"].splitlines()
desired = f'{key}: "{val.replace(chr(92), chr(92) * 2).replace(chr(34), chr(92) + chr(34))}"'
idx = next((i for i, l in enumerate(lines) if l.split(":", 1)[0].strip() == key), None)
if idx is not None and lines[idx].strip() == desired:
    out = lines  # already correct — leave the file untouched
else:
    out = [l for i, l in enumerate(lines) if i != idx]
    out.append(desired)
sys.stdout.write("\n".join(out) + ("\n" if out else ""))
PY
)"
  [ "$cur" = "$new" ] && {
    info "secrets.yaml: $key already current"
    return 1
  }
  if [ "$DRYRUN" -eq 1 ]; then
    info "dry-run: would upsert $key in secrets.yaml"
    return 0
  fi
  printf '%s\n' "$new" |
    ssh_run "cat > '$REMOTE_CONFIG/secrets.yaml.tmp' && mv '$REMOTE_CONFIG/secrets.yaml.tmp' '$REMOTE_CONFIG/secrets.yaml'" ||
    die "failed to write secrets.yaml"
  info "secrets.yaml: upserted $key"
  return 0
}

# Ensure the "Heater schedules" local_calendar exists (entity_id
# calendar.heater_schedules — the scheduling package and SPA both hard-code it).
# Idempotent via the config-entries flow, same as ha-dev/setup.py. Returns 0 if it
# created the calendar (-> reload so the calendar-triggered automation attaches),
# 1 if already present.
CALENDAR_NAME="Heater schedules"
manage_calendar() {
  local entries flow_id
  entries="$(ha_curl GET /api/config/config_entries/entry)" || die "couldn't list config entries"
  if printf '%s' "$entries" | CAL="$CALENDAR_NAME" python3 -c '
import json, os, sys
data = json.load(sys.stdin)
sys.exit(0 if any(e.get("domain") == "local_calendar" and e.get("title") == os.environ["CAL"] for e in data) else 1)
'; then
    info "calendar '$CALENDAR_NAME' already present"
    return 1
  fi
  if [ "$DRYRUN" -eq 1 ]; then
    info "dry-run: would create local_calendar '$CALENDAR_NAME'"
    return 0
  fi
  info "creating local_calendar '$CALENDAR_NAME'"
  flow_id="$(ha_curl POST /api/config/config_entries/flow '{"handler":"local_calendar","show_advanced_options":false}' |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["flow_id"])')" ||
    die "couldn't start local_calendar flow"
  ha_curl POST "/api/config/config_entries/flow/$flow_id" \
    "$(CAL="$CALENDAR_NAME" python3 -c 'import json,os; print(json.dumps({"calendar_name": os.environ["CAL"], "import": "create_empty"}))')" \
    >/dev/null || die "couldn't finish local_calendar flow"
  info "created '$CALENDAR_NAME' (calendar.heater_schedules)"
  return 0
}

needs_reload=0
needs_restart=0

if sync "packages/" "$HA_SRC/packages/" "packages/"; then needs_reload=1; fi
if sync "blueprints/heater_control" \
  "$HA_SRC/blueprints/automation/heater_control/" \
  "blueprints/automation/heater_control/"; then needs_reload=1; fi

# Repo-tracked custom_components, one dir at a time (--delete stays scoped inside
# a component we own). No-op until homeassistant/custom_components/ exists.
if [ -d "$HA_SRC/custom_components" ]; then
  for comp in "$HA_SRC"/custom_components/*/; do
    [ -d "$comp" ] || continue
    if sync "custom_components/$(basename "$comp")" "$comp" "custom_components/$(basename "$comp")/"; then
      needs_restart=1
    fi
  done
fi

# --- OIDC bundle: patched component + includes + secret (all -> restart) ---
if [ "$OIDC" -eq 1 ]; then
  if sync "custom_components/auth_oidc" \
    "$STAGE/custom_components/auth_oidc/" "custom_components/auth_oidc/"; then needs_restart=1; fi
  if sync "auth_oidc.yaml" "$STAGE/auth_oidc.yaml" "auth_oidc.yaml"; then needs_restart=1; fi
  if sync "http.yaml" "$STAGE/http.yaml" "http.yaml"; then needs_restart=1; fi
  if manage_oidc_secret; then needs_restart=1; fi
fi

# --- ensure the local_calendar config entry (reload to attach the automation) ---
if [ "$CALENDAR" -eq 1 ]; then
  if manage_calendar; then needs_reload=1; fi
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
