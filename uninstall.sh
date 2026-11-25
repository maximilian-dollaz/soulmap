#!/usr/bin/env bash
# Stop the Soul Map and remove its background service and daily updater. Your data stays in data/ and report/
# until you delete this folder. Ollama and its models stay; remove them from the Ollama app.
set -euo pipefail
LABEL="${SOUL_LABEL:-com.soulmap.app}"
for L in "$LABEL" "$LABEL.update"; do
  launchctl bootout "gui/$(id -u)/$L" 2>/dev/null || true
  rm -f "$HOME/Library/LaunchAgents/$L.plist"
done
echo "The Soul Map is stopped and will not start at login. Delete $(cd "$(dirname "$0")" && pwd) to remove it and your data."
echo "The private copy of Node and the logs are in $HOME/.soulmap; delete that folder too if no other copy of the Soul Map uses it."
