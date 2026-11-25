#!/usr/bin/env bash
# Copies the shareable part of this repo into a clean folder for the public repo (github.com/maximilian-dollaz/soulmap).
# Left out: personal data (ignored anyway), internal planning notes, and the old voice-agent scripts.
#   scripts/export-public.sh <target-dir>
set -euo pipefail
SRC="$(cd "$(dirname "$0")/.." && pwd)"
DST="${1:?usage: export-public.sh <target-dir>}"
mkdir -p "$DST"
EXCLUDE=(HANDOFF.md PROJECT.md INTEGRATION.md PEER-INPUT.md SPEC.md start.sh docs hooks
  app/scripts app/README.md app/.env.example app/tsconfig.tsbuildinfo analysis/extract_user_messages.py)
cd "$SRC"
# Tracked and new-but-not-ignored files, minus the exclusions.
{ git ls-files; git ls-files --others --exclude-standard; } | sort -u | while IFS= read -r f; do
  [[ -f "$f" ]] || continue
  for x in "${EXCLUDE[@]}"; do [[ "$f" == "$x" || "$f" == "$x"/* ]] && continue 2; done
  mkdir -p "$DST/$(dirname "$f")"
  cp -p "$f" "$DST/$f"
done
# Nothing personal may leave: stop if a known private marker slipped in.
if grep -rIl -E "maxmuzones|mkmuzones|tail0f1ba6|sk-ant-a[a-z0-9]|Amanda|True Nature|[Ss]chlender|recall-server" "$DST" --exclude-dir=.git --exclude-dir=node_modules --exclude=export-public.sh; then
  echo "export-public: private markers found in the files above; fix them before publishing." >&2; exit 1
fi
echo "exported to $DST"
