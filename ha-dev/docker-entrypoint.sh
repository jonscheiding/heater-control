#!/usr/bin/env sh
# Self-provisioning entrypoint for the Home Assistant image.
#
# Runs as the container ENTRYPOINT (before HA) and behaves identically under
# `docker compose` (dev) and `docker run`/Fly (demo). Everything env-specific
# (OIDC issuer, CORS, trusted proxies) is rendered from environment variables,
# so one image serves both. A bind-mounted or volume /config hides anything
# baked at /config, so config is staged from /opt/provision at start. Ends by
# exec'ing the base image's s6 init.
set -eu

CONFIG=/config
SRC=/opt/provision

echo "[entrypoint] provisioning $CONFIG"
mkdir -p "$CONFIG/custom_components"

# auth_oidc is baked (pinned + patched) at build time and the image is the source
# of truth (no HACS/runtime self-update), so ALWAYS refresh it. This way a rebuild
# or version bump propagates even onto a persisted /config (dev bind mount or a
# Fly volume) instead of leaving a stale copy behind.
echo "[entrypoint] installing auth_oidc"
rm -rf "$CONFIG/custom_components/auth_oidc"
cp -r "$SRC/custom_components/auth_oidc" "$CONFIG/custom_components/auth_oidc"

# Base config: always refresh from the image (the image is the source of truth).
cp "$SRC/configuration.yaml" "$CONFIG/configuration.yaml"

# Env-driven includes (OIDC + http).
python3 "$SRC/lib/render_config.py"

# Full config staging for volume-less / no-bind-mount deploys (Fly). In dev,
# packages/ and blueprints/ are bind-mounted, so this stays off.
if [ "${HC_STAGE_CONFIG:-0}" = "1" ]; then
  echo "[entrypoint] staging packages + blueprints"
  mkdir -p "$CONFIG/packages" "$CONFIG/blueprints/automation"
  cp -r "$SRC/packages/." "$CONFIG/packages/"
  cp -r "$SRC/blueprints/." "$CONFIG/blueprints/"
fi

# Optional self-onboarding (dev + Fly demo). Backgrounded: waits for HA to come
# up, then onboards the owner + ensures the local calendar. Skipped on the real
# HAOS box (flag unset) so onboarding is done once, by hand, with real creds.
if [ "${HC_AUTO_SETUP:-0}" = "1" ]; then
  echo "[entrypoint] auto-setup enabled; onboarding will run once HA is up"
  HA_URL="${HA_URL:-http://localhost:8123}" python3 "$SRC/lib/provision.py" &
fi

# Launch Home Assistant directly, bypassing the base image's s6 init. s6 insists
# on being PID 1, which fails on platforms whose own init keeps PID 1 (Fly.io
# Machines: "s6-overlay-suexec: fatal: can only run as pid 1"), and s6 has no way
# to run otherwise. The image has no cont-init scripts and a single HA service,
# so this replicates its launch exactly (see /etc/services.d/home-assistant/run);
# process supervision is handled by the compose/Fly restart policy instead.
echo "[entrypoint] launching Home Assistant"
cd /config
if [ -z "${DISABLE_JEMALLOC:-}" ] && [ -f /usr/local/lib/libjemalloc.so.2 ]; then
  export LD_PRELOAD="/usr/local/lib/libjemalloc.so.2"
  export MALLOC_CONF="background_thread:true,metadata_thp:auto,dirty_decay_ms:20000,muzzy_decay_ms:20000"
fi
exec python3 -m homeassistant --config /config
