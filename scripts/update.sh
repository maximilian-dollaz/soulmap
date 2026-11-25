#!/usr/bin/env bash
# The Soul Map: quiet daily update. A background job (com.soulmap.update, set up by install.sh) runs this
# once a day. If the public repo has a newer version than this Mac, it re-runs the installer, which
# downloads it, rebuilds and restarts the app. Your data/ and report/ are never touched.
#   scripts/update.sh          check and update if there is something new
#   scripts/update.sh --force  update even if the version looks current
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
API="https://api.github.com/repos/maximilian-dollaz/soulmap/commits/main"
RAW="https://raw.githubusercontent.com/maximilian-dollaz/soulmap"
log() { printf '%s %s\n' "$(date '+%Y-%m-%d %H:%M')" "$*"; }

# Only folders the installer downloaded update themselves; a developer checkout is left alone.
[[ -f "$DIR/.soulmap-download" ]] || { log "not an installed copy ($DIR); skipping"; exit 0; }

# No network (asleep, offline, rate limited): try again tomorrow.
LATEST="$(curl -fsSL --max-time 20 "$API" 2>/dev/null | grep -m1 '"sha"' | cut -d'"' -f4 || true)"
[[ -n "$LATEST" ]] || { log "could not reach GitHub; will try again next time"; exit 0; }
CURRENT="$(cat "$DIR/.soulmap-version" 2>/dev/null || true)"
if [[ "$LATEST" == "$CURRENT" && "${1:-}" != "--force" ]]; then log "up to date (${CURRENT:0:7})"; exit 0; fi

log "updating ${CURRENT:0:7} -> ${LATEST:0:7}"
# Run the installer for that exact version from a temp copy, so the download can replace this folder's files safely.
TMP="$(mktemp -t soulmap-install)"
trap 'rm -f "$TMP"' EXIT
curl -fsSL --max-time 60 "$RAW/$LATEST/install.sh" -o "$TMP"
SOUL_DIR="$DIR" SOUL_REF="$LATEST" SOUL_NO_OPEN=1 bash "$TMP"
log "updated to ${LATEST:0:7}"
