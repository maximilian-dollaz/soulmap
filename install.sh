#!/usr/bin/env bash
# The Soul Map: one-command install for a Mac.
#
#   curl -fsSL https://soulmap.nextmissionsi.com/install.sh | bash
#   or, from a downloaded copy:  ./install.sh
#
# It installs what is missing (Node, and uv for Python), builds the app, keeps it running in the
# background, and opens it at http://localhost:3355/soul. The local model is optional (onboarding asks).
# Nothing needs an admin password. It also checks for a new version once a day and updates itself
# (scripts/update.sh). Re-run it any time to update now. Remove with ./uninstall.sh.
#
# Overrides: SOUL_REF (a commit to install), SOUL_LOCAL=1 (install the local model now), SOUL_DIR, SOUL_PORT, SOUL_LABEL, SOUL_MODEL, SOUL_NO_OPEN=1.
set -euo pipefail

REPO="https://github.com/maximilian-dollaz/soulmap"
PORT="${SOUL_PORT:-3355}"
LABEL="${SOUL_LABEL:-com.soulmap.app}"
TOOLS="$HOME/.soulmap"
say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31m%s\033[0m\n' "$*" >&2; DIED=1; exit 1; }

[[ "$(uname)" == "Darwin" ]] || die "The Soul Map installer is for macOS."
# Any step that fails stops the install with one plain sentence instead of a bare exit. (An EXIT trap,
# not ERR: macOS's bash 3.2 skips the ERR trap when a ( subshell ) fails under set -e.)
trap 'rc=$?; [[ $rc -eq 0 || -n "${DIED:-}" ]] || printf "\n\033[31m%s\033[0m\n" "The install stopped before it finished. Run the same command again; if it stops again, send the person who shared it a screenshot of this window." >&2' EXIT
mkdir -p "$TOOLS"

# 1. The code: this folder when run from a copy, otherwise a fresh download into ~/SoulMap.
HERE="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || true)"
if [[ -n "${SOUL_DIR:-}" ]]; then DIR="$SOUL_DIR"
elif [[ -f "$HERE/app/package.json" ]]; then DIR="$HERE"
else DIR="$HOME/SoulMap"; fi
# A folder this installer downloaded (marked .soulmap-download) is refreshed on every run, so re-running
# updates it; your data/ and report/ are not in the download and stay. A folder you manage yourself is left alone.
if [[ ! -f "$DIR/app/package.json" || -f "$DIR/.soulmap-download" ]]; then
  # Pin the exact version downloaded, so the daily updater (scripts/update.sh) knows when there is a newer one.
  REF="${SOUL_REF:-$(curl -fsSL --max-time 20 "https://api.github.com/repos/maximilian-dollaz/soulmap/commits/main" 2>/dev/null | grep -m1 '"sha"' | cut -d'"' -f4 || true)}"
  say "Downloading the Soul Map into $DIR"
  mkdir -p "$DIR"
  if [[ -n "$REF" ]]; then curl -fsSL "$REPO/archive/$REF.tar.gz" | tar -xz -C "$DIR" --strip-components 1
  else curl -fsSL "$REPO/archive/refs/heads/main.tar.gz" | tar -xz -C "$DIR" --strip-components 1; fi
  touch "$DIR/.soulmap-download"
  if [[ -n "$REF" ]]; then echo "$REF" > "$DIR/.soulmap-version"; else rm -f "$DIR/.soulmap-version"; fi
fi
cd "$DIR"

# 2. Node 20+ (a private copy in ~/.soulmap/node if this Mac has none).
NODE_BIN=""
if command -v node >/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]]; then
  NODE_BIN="$(dirname "$(command -v node)")"
elif [[ -x "$TOOLS/node/bin/node" ]]; then NODE_BIN="$TOOLS/node/bin"
else
  say "Installing Node"
  ARCH="$(uname -m)"; [[ "$ARCH" == "x86_64" ]] && ARCH="x64"
  VER="$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22[^"]*"' | head -1 | cut -d'"' -f4)"
  mkdir -p "$TOOLS/node"
  curl -fsSL "https://nodejs.org/dist/$VER/node-$VER-darwin-$ARCH.tar.gz" | tar -xz -C "$TOOLS/node" --strip-components 1
  NODE_BIN="$TOOLS/node/bin"
fi
export PATH="$NODE_BIN:$PATH"

# 3. uv (runs the Python chart calculator and the evidence pipeline; it fetches Python itself).
UV="$(command -v uv || true)"; [[ -z "$UV" && -x "$HOME/.local/bin/uv" ]] && UV="$HOME/.local/bin/uv"
if [[ -z "$UV" ]]; then
  say "Installing uv"
  curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null
  UV="$HOME/.local/bin/uv"
fi

# 4. The local model is optional: onboarding asks whether Claude (your API key) or this Mac does the
#    thinking, and installs the local model only if you pick it. SOUL_LOCAL=1 installs it now instead.
MODEL=""
if [[ -n "${SOUL_LOCAL:-}" ]]; then
  say "Installing the local model (one time, a few GB)"
  MODEL="$(bash "$DIR/scripts/local-model.sh" | awk '/^DONE /{print $2}')"
  [[ -n "$MODEL" ]] || die "The local model did not install."
fi

# 5. Python pieces, then the app.
#    Python 3.11 is pinned: the chart library ships a ready-made Mac build only for 3.11, and any newer
#    Python makes uv compile it from source, which needs Apple's developer tools (absent on a fresh Mac)
#    and takes minutes. only-managed keeps uv off /usr/bin/python3, which on a fresh Mac pops up an
#    "install developer tools" window.
export UV_PYTHON_PREFERENCE=only-managed
say "Preparing the chart calculator (about a minute)"
(cd analysis/hdcalc && "$UV" sync -q --python 3.11 --no-build-package pyswisseph)
(cd evidence && "$UV" sync -q --python 3.11)

say "Building the app (2 to 5 minutes; the window stays quiet while it works)"
cd app
ENV=.env.local
touch "$ENV"
set_env() { grep -q "^$1=" "$ENV" && sed -i '' "s|^$1=.*|$1=$2|" "$ENV" || printf '%s=%s\n' "$1" "$2" >> "$ENV"; }
grep -q '^SOUL_OWNER=' "$ENV" || set_env SOUL_OWNER me
[[ -n "$MODEL" ]] && set_env SOUL_LOCAL_MODEL "$MODEL"
set_env UV_BIN "$UV"
# Telemetry off: Next.js otherwise runs `git` to name the project, and on a fresh Mac that pops up an
# "install developer tools" window. The npm update notice is noise for this install.
export NEXT_TELEMETRY_DISABLED=1 npm_config_update_notifier=false
npm ci --no-audit --no-fund --loglevel=error
npm run -s build >/dev/null

# 6. Keep it running (starts at login, restarts if it stops).
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
mkdir -p "$HOME/Library/LaunchAgents" "$TOOLS/logs"
cat > "$PLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array>
    <string>$NODE_BIN/node</string><string>$DIR/app/node_modules/next/dist/bin/next</string>
    <string>start</string><string>-H</string><string>127.0.0.1</string><string>-p</string><string>$PORT</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR/app</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_BIN:$(dirname "$UV"):/usr/bin:/bin</string>
    <key>HOME</key><string>$HOME</string>
    <key>NODE_ENV</key><string>production</string>
    <key>NEXT_TELEMETRY_DISABLED</key><string>1</string>
    <key>UV_PYTHON_PREFERENCE</key><string>only-managed</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$TOOLS/logs/$LABEL.out</string>
  <key>StandardErrorPath</key><string>$TOOLS/logs/$LABEL.err</string>
</dict></plist>
PL
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
# A service that was just stopped takes a moment to unload; retry instead of failing an update.
for i in $(seq 1 15); do launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break; [[ $i == 15 ]] && die "Could not start the background service ($LABEL)."; sleep 1; done
# 7. Daily update check (installed copies only): at 4:17 each morning, or when the Mac next wakes,
#    scripts/update.sh compares this copy with the public repo and re-runs this installer if it is behind.
if [[ -f "$DIR/.soulmap-download" ]]; then
  ULABEL="$LABEL.update"
  UPLIST="$HOME/Library/LaunchAgents/$ULABEL.plist"
  cat > "$UPLIST" <<PL
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$ULABEL</string>
  <key>ProgramArguments</key><array><string>/bin/bash</string><string>$DIR/scripts/update.sh</string></array>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>$NODE_BIN:$(dirname "$UV"):/usr/bin:/bin:/usr/sbin:/sbin</string>
    <key>HOME</key><string>$HOME</string>
    <key>SOUL_LABEL</key><string>$LABEL</string>
    <key>SOUL_PORT</key><string>$PORT</string>
  </dict>
  <key>StartCalendarInterval</key><dict><key>Hour</key><integer>4</integer><key>Minute</key><integer>17</integer></dict>
  <key>StandardOutPath</key><string>$TOOLS/logs/$ULABEL.log</string>
  <key>StandardErrorPath</key><string>$TOOLS/logs/$ULABEL.log</string>
</dict></plist>
PL
  # Reloading the job would stop an update that is running right now (this script, called by it), so load it only when it is not loaded.
  launchctl print "gui/$(id -u)/$ULABEL" >/dev/null 2>&1 || launchctl bootstrap "gui/$(id -u)" "$UPLIST" 2>/dev/null || true
fi

URL="http://localhost:$PORT/soul"
for _ in $(seq 1 30); do [[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL")" == "200" ]] && break; sleep 1; done
[[ "$(curl -s -o /dev/null -w '%{http_code}' "$URL")" == "200" ]] || die "The app did not start. Log: $TOOLS/logs/$LABEL.err"

say "The Soul Map is running: $URL"
echo "Your answers and results stay on this Mac, in $DIR/data and $DIR/report."
[[ -n "${SOUL_NO_OPEN:-}" ]] || open "$URL"
