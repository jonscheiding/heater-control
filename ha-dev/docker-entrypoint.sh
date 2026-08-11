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

# Other repo-tracked custom components (schedulemaster, ...): same deal — the
# image is the source of truth, so always refresh from it (Python components
# don't hot-reload; a `docker compose restart` re-stages the mounted sources).
for comp in "$SRC"/custom_components/*/; do
  name=$(basename "$comp")
  [ "$name" = "auth_oidc" ] && continue
  echo "[entrypoint] installing custom_component $name"
  rm -rf "$CONFIG/custom_components/$name"
  cp -r "$comp" "$CONFIG/custom_components/$name"
done

# Base config: always refresh from the image (the image is the source of truth).
cp "$SRC/configuration.yaml" "$CONFIG/configuration.yaml"

# Env-driven config: the OIDC/ScheduleMaster includes, plus the HTTP settings
# (CORS + proxy trust) seeded into .storage/http — HA 2026.8 moved those out of
# YAML into the UI, so they have to be in place before HA starts.
python3 "$SRC/render_config.py"

# Packages (scheduling + heaters generated from the roster) and blueprints,
# staged from the image (the source of truth). Dev bind-mounts the sources over
# /opt/provision, so `docker compose restart` picks up roster/blueprint edits.
echo "[entrypoint] staging packages + blueprints"
mkdir -p "$CONFIG/packages" "$CONFIG/blueprints/automation"
cp -r "$SRC/packages/." "$CONFIG/packages/"   # static packages (scheduling, ...)
rm -f "$CONFIG"/packages/heater_*.yaml         # strip baked/stale heaters, then regen
python3 "$SRC/gen_packages.py" --input "${HEATERS_JSON:-$SRC/heaters.demo.json}" --out "$CONFIG/packages"
cp -r "$SRC/blueprints/." "$CONFIG/blueprints/"

# Optional self-onboarding (dev + Fly demo). Backgrounded: waits for HA to come
# up, then onboards the owner + ensures the local calendar. Skipped on the real
# HAOS box (flag unset) so onboarding is done once, by hand, with real creds.
if [ "${HC_AUTO_SETUP:-0}" = "1" ]; then
  echo "[entrypoint] auto-setup enabled; onboarding will run once HA is up"
  HA_URL="${HA_URL:-http://localhost:8123}" python3 "$SRC/setup.py" &
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
