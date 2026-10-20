#!/usr/bin/env bash
# Container entrypoint: display, web view, and the original application.
#
# The container exits (and Docker restarts it) when any essential process dies,
# including when the application is closed from the tab.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${MBL_APP_DIR:-/opt/mbl-app}"
DATA_DIR="${MBL_DATA_DIR:-/data}"
DIST_DIR="${MBL_DIST_DIR:-/opt/mbl-dist}"
export DISPLAY="${DISPLAY:-:99}"

# Fail before starting anything if the token is missing or weak.
if ! [[ "${MBL_ACCESS_TOKEN:-}" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  echo "MBL_ACCESS_TOKEN is required: 16-128 characters from [A-Za-z0-9_-]." >&2
  echo "Generate one with: openssl rand -hex 24" >&2
  exit 64
fi

# --- Persistence -----------------------------------------------------------
# The application writes next to its executable, and downloads its own
# components (proxy helper, Chrome-based browser) into C:\ProgramData inside the
# Wine prefix. Both are redirected to the data volume so they survive restarts
# instead of being downloaded again each time.
mkdir -p "$DATA_DIR"/{Data,Backups,BackupTemp,Logs,UpdateInstall}
mkdir -p "$DATA_DIR"/ProgramData/{SharkBrowser,S5Proxyer}

if [ -z "$(ls -A "$DATA_DIR/Data" 2>/dev/null)" ] && [ -d "$DIST_DIR/Data" ]; then
  cp -a "$DIST_DIR/Data/." "$DATA_DIR/Data/"
fi

for d in Data Backups BackupTemp Logs UpdateInstall; do
  ln -sfn "$DATA_DIR/$d" "$APP_DIR/$d"
done

PROGRAM_DATA="${WINEPREFIX:-$HOME/.wine}/drive_c/ProgramData"
mkdir -p "$PROGRAM_DATA"
for c in SharkBrowser S5Proxyer; do
  ln -sfn "$DATA_DIR/ProgramData/$c" "$PROGRAM_DATA/$c"
done

# --- Processes ---------------------------------------------------------------
bash "$HERE/start-display.sh"
bash "$HERE/start-web.sh" &
bash "$HERE/dismiss-dialogs.sh" &

cd "$APP_DIR"
wine MarketerBrowserLite.exe &

# --- Supervision -------------------------------------------------------------
# Give everything time to start, then require the essential processes.
sleep 25
missing=0
while :; do
  sleep 3
  dead=""
  for name in Xvfb openbox x11vnc websockify; do
    pgrep -x "$name" >/dev/null 2>&1 || pgrep -f "$name" >/dev/null 2>&1 || dead="$dead $name"
  done
  pgrep -f "MarketerBrowserLite.exe" >/dev/null 2>&1 || dead="$dead MarketerBrowserLite.exe"

  if [ -n "$dead" ]; then
    missing=$((missing + 1))
    if [ "$missing" -ge 2 ]; then
      echo "entrypoint: essential process not running:$dead - stopping" >&2
      exit 1
    fi
  else
    missing=0
  fi
done
