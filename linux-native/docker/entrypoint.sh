#!/usr/bin/env bash
# Container entrypoint: display, web view, and the original application.
#
# The container exits (and Docker restarts it) when any essential process dies,
# including when the application is closed from the tab.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${MBL_DATA_DIR:-/data}"
APP_DIR="${MBL_APP_DIR:-$DATA_DIR/app}"
export DISPLAY="${DISPLAY:-:99}"

# Fail before starting anything if the token is missing or weak.
if ! [[ "${MBL_ACCESS_TOKEN:-}" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  echo "MBL_ACCESS_TOKEN is required: 16-128 characters from [A-Za-z0-9_-]." >&2
  echo "Generate one with: openssl rand -hex 24" >&2
  exit 64
fi

# Validate the mounted archive before creating or changing persistent app files.
bash "$HERE/install-app.sh"

# --- Persistence -----------------------------------------------------------
# The application writes next to its executable, and downloads its own
# components (proxy helper, Chrome-based browser) into C:\ProgramData inside the
# Wine prefix. Both are redirected to the data volume so they survive restarts
# instead of being downloaded again each time.
mkdir -p "$DATA_DIR"/{Data,Backups,BackupTemp,Logs,UpdateInstall}
mkdir -p "$DATA_DIR"/ProgramData/{SharkBrowser,S5Proxyer}

for d in Data Backups BackupTemp Logs UpdateInstall; do
  app_data="$APP_DIR/$d"
  data_target="$DATA_DIR/$d"
  if [ -d "$app_data" ] && [ ! -L "$app_data" ]; then
    # Migrate any initial or pre-existing app-local files without overwriting
    # data already stored in the persistent volume.
    cp -an "$app_data/." "$data_target/"
  fi
  rm -rf -- "$app_data"
  ln -s "$data_target" "$app_data"
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
bash "$HERE/fit-main-window.sh" &

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
