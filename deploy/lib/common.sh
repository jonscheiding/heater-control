#!/usr/bin/env bash
# Shared shell helpers for the deploy toolkit. Sourced by push.sh / bootstrap.sh.
# Not meant to be executed directly.

DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$DEPLOY_DIR/.." && pwd)"

# auth_oidc release the deploy ships (pinned + patched, no HACS on prod). Keep in
# sync with ha-dev/Dockerfile's AUTH_OIDC_VERSION — both build the same component.
AUTH_OIDC_VERSION="${AUTH_OIDC_VERSION:-v1.1.1}"

die() {
  echo "error: $*" >&2
  exit 1
}

info() { echo "[deploy] $*" >&2; }

# Load deploy/.env into the environment if present (values already in the env win
# only if you export them before calling; .env is authoritative otherwise).
load_env() {
  local f="$DEPLOY_DIR/.env"
  if [ -f "$f" ]; then
    set -a
    # shellcheck disable=SC1090
    . "$f"
    set +a
  fi
}

# require VAR...  — die if any named var is empty.
require() {
  local missing=0 v
  for v in "$@"; do
    if [ -z "${!v:-}" ]; then
      echo "error: $v is required (set it in deploy/.env)" >&2
      missing=1
    fi
  done
  [ "$missing" -eq 0 ] || exit 1
}

# ha_preflight — verify HA_URL is reachable and HA_TOKEN authorizes the core API,
# so a bad token/URL fails clearly up front instead of mid-run. Note: the token
# authorizes core /api but NOT the Supervisor proxy (/api/hassio 401s) — that's
# expected, so we probe /api/ only.
ha_preflight() {
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' \
    -H "Authorization: Bearer ${HA_TOKEN}" "${HA_URL%/}/api/" 2>/dev/null)" ||
    die "can't reach HA at ${HA_URL} (connection failed — check HA_URL / network / Tailscale)"
  case "$code" in
    200) info "preflight: HA reachable and token accepted" ;;
    401 | 403) die "HA rejected the token (${code}) — check HA_TOKEN (a long-lived access token from Profile -> Security)" ;;
    000) die "no response from ${HA_URL} — check HA_URL / network / Tailscale" ;;
    *) die "unexpected HTTP ${code} from ${HA_URL%/}/api/ — check HA_URL" ;;
  esac
}

# ha_curl METHOD PATH [json-body] — call HA's REST API with the bearer token.
ha_curl() {
  curl -fsS -X "$1" \
    -H "Authorization: Bearer ${HA_TOKEN}" \
    -H "Content-Type: application/json" \
    "${HA_URL%/}$2" ${3:+-d "$3"}
}

# materialize_auth_oidc DEST_DIR — download the pinned release and overlay our
# local patch, exactly as ha-dev/Dockerfile does at build time. stdlib-only so it
# runs anywhere python3 is present.
materialize_auth_oidc() {
  local dest="$1"
  local url="https://github.com/christiaangoossens/hass-oidc-auth/releases/download/${AUTH_OIDC_VERSION}/hass-oidc-auth.zip"
  local tmpzip
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
  # Overlay the local patch (endpoints/finish.py, etc.).
  cp -R "$REPO_ROOT/homeassistant/patches/auth_oidc/." "$dest/"
}
