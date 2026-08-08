#!/usr/bin/env bash
# Scaffold a new heater package from the canonical heater.yaml.tml template.
#
#   deploy/heater.sh add --n 4 --name "Cessna 172" [--duration 3h]
#
# Writes homeassistant/packages/heater_<n>.yaml with the entity ids, friendly
# names, and auto-off duration substituted. The new input_boolean/timer entities
# appear in HA on the next `deploy/push.sh` (reload_all, no restart); the SPA
# picks them up over WebSocket with no code change.
#
# The generated package is POC-shaped (input_boolean + simulated power), matching
# the existing heaters. When a real metering switch is available, pair it in HA,
# then replace input_boolean.heater_<n> with the switch entity and delete the POC
# block (guidance is printed after generation).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$REPO_ROOT/homeassistant/packages"
TEMPLATE="$PKG_DIR/heater.yaml.tmpl"

die() {
  echo "error: $*" >&2
  exit 1
}

usage() {
  cat >&2 <<'EOF'
usage: deploy/heater.sh add --n <number> --name <label> [--duration <dur>] [--force]

  --n         heater number (positive integer, not 1); target packages/heater_<n>.yaml
  --name      friendly name shown in the UI (e.g. "Cessna 172")
  --duration  auto-off window: HH:MM:SS, or shorthand 3h / 90m (default: template's 2h)
  --force     overwrite an existing package file
EOF
  exit 1
}

# Normalize a duration to HH:MM:SS. Accepts HH:MM:SS, <N>h, or <N>m.
normalize_duration() {
  local d="$1" n
  if [[ "$d" =~ ^[0-9]{1,2}:[0-9]{2}:[0-9]{2}$ ]]; then
    printf '%s' "$d"
  elif [[ "$d" =~ ^([0-9]+)h$ ]]; then
    printf '%02d:00:00' "${BASH_REMATCH[1]}"
  elif [[ "$d" =~ ^([0-9]+)m$ ]]; then
    n="${BASH_REMATCH[1]}"
    printf '%02d:%02d:00' "$((n / 60))" "$((n % 60))"
  else
    return 1
  fi
}

[ "${1:-}" = "add" ] || usage
shift

N=""
NAME=""
DURATION=""
FORCE=0
while [ $# -gt 0 ]; do
  case "$1" in
    --n) N="${2:-}" && shift 2 ;;
    --name) NAME="${2:-}" && shift 2 ;;
    --duration) DURATION="${2:-}" && shift 2 ;;
    --force) FORCE=1 && shift ;;
    -h | --help) usage ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$N" ] || usage
[ -n "$NAME" ] || usage
[[ "$N" =~ ^[0-9]+$ ]] || die "--n must be a positive integer (got '$N')"
[ "$N" -ge 1 ] || die "--n must be >= 1"
[ -f "$TEMPLATE" ] || die "template not found: $TEMPLATE"

HMS=""
if [ -n "$DURATION" ]; then
  HMS="$(normalize_duration "$DURATION")" || die "bad --duration '$DURATION' (want HH:MM:SS, 3h, or 90m)"
fi

OUT="$PKG_DIR/heater_${N}.yaml"
if [ -e "$OUT" ] && [ "$FORCE" -ne 1 ]; then
  die "$OUT already exists (use --force to overwrite)"
fi

# Escape sed-special chars in the friendly name so names with & / \ survive.
esc_name="$(printf '%s' "$NAME" | sed -e 's/[&/\]/\\&/g')"

# heater_1 -> heater_N covers all entity ids (incl. _autooff, _simulated_watts,
# _power); "Heater 1" -> NAME covers every friendly-name/alias occurrence. The
# two never collide (one lowercase id, one capitalized label).
tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.2"' EXIT
sed -e "s/heater_1/heater_${N}/g" -e "s/Heater 1/${esc_name}/g" "$TEMPLATE" >"$tmp"

if [ -n "$HMS" ]; then
  sed -e "s#duration: \"02:00:00\"#duration: \"${HMS}\"#" "$tmp" >"$tmp.2"
  mv "$tmp.2" "$tmp"
fi

mv "$tmp" "$OUT"
trap - EXIT

echo "wrote $OUT  (name=\"$NAME\"${HMS:+, duration=$HMS})"
echo
echo "next:"
echo "  • deploy/push.sh   — ship it to the box and reload_all (no restart)"
echo "  • real switch?     — pair the device in HA, then in $OUT replace"
echo "                       input_boolean.heater_${N} with switch.heater_${N} and"
echo "                       delete the POC-only block at the bottom."
