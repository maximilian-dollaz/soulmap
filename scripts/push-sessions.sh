#!/usr/bin/env bash
# For a Soul Map that runs on a server while Claude Code runs on this Mac: once a day, import this Mac's
# Claude Code sessions (only the person's own lines, cleaned) and copy that one file to the server's evidence
# cache as claude-code-mac.jsonl. The server's daily sync scores it with everything else.
#   SOUL_SERVER (ssh alias), SOUL_SERVER_DIR (Soul Map folder on the server), SOUL_PERSON (profile id)
set -euo pipefail
HERE="$(cd "$(dirname "$0")/.." && pwd)"
SERVER="${SOUL_SERVER:?set SOUL_SERVER to the ssh alias of the server}"
REMOTE_DIR="${SOUL_SERVER_DIR:?set SOUL_SERVER_DIR to the Soul Map folder on the server}"
PERSON="${SOUL_PERSON:?set SOUL_PERSON to your profile id}"
UV="${UV_BIN:-$HOME/.local/bin/uv}"
cd "$HERE/evidence"
"$UV" run evidence import --source claude-code --file "$HOME/.claude/projects" --person "$PERSON"
FILE="$HERE/evidence/cache/$PERSON/claude-code.jsonl"
DEST="$REMOTE_DIR/evidence/cache/$PERSON"
ssh -o BatchMode=yes "$SERVER" "mkdir -p '$DEST' && cat > '$DEST/claude-code-mac.jsonl'" < "$FILE"
echo "$(date '+%F %T') pushed $(wc -l < "$FILE" | tr -d ' ') of your lines to $SERVER"
