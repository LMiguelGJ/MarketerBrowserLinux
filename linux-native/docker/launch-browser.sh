#!/usr/bin/env bash
# Launch the Chromium build the application downloaded, in the shared display.
#
# The application's own launch path stops at "Analyzing proxy IP" and never
# starts the browser (its proxy helper needs a Windows kernel driver, which
# cannot load under Wine). The Chromium it downloads does run under Wine, so it
# is started here directly, in the same display the viewer shows.
#
# The browser takes over the whole screen, exactly like the application window:
# the viewer shows one surface at a time.
#
# Environment:
#   DISPLAY               (default :99)
#   MBL_BROWSER_DATA_DIR  Chromium profile directory (default under the prefix)
set -u

export DISPLAY="${DISPLAY:-:99}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PREFIX="${WINEPREFIX:-$HOME/.wine}"
SHARK_DIR="${MBL_SHARK_DIR:-$PREFIX/drive_c/ProgramData/SharkBrowser/SharkBrowser}"
DATA_DIR="${MBL_BROWSER_DATA_DIR:-$PREFIX/drive_c/profiles/mbl}"

log() {
  echo "launch-browser: $*"
}

# The launcher the application downloads sits at the root of that directory; the
# version folder holds the payload.
launcher=""
for candidate in \
  "$SHARK_DIR/chrome.exe" \
  "$SHARK_DIR"/*/chrome-win/chrome.exe \
  "$SHARK_DIR"/*/chrome.exe; do
  [ -f "$candidate" ] && { launcher="$candidate"; break; }
done

if [ -z "$launcher" ]; then
  log "no Chromium launcher found under $SHARK_DIR"
  exit 66
fi

# The browser creates dozens of 1x1 helper windows: only the real one has a
# size. The largest candidate is the browser window.
browser_window() {
  local id size
  for id in $(xdotool search --class 'chrome.exe' 2>/dev/null) \
             $(xdotool search --class 'Chromium' 2>/dev/null); do
    size="$(xwininfo -id "$id" 2>/dev/null |
      awk -F': ' '/Width:/ {w=$2} /Height:/ {h=$2} END {print w" "h}')"
    [ "${size%% *}" -ge 200 ] 2>/dev/null || continue
    [ "${size##* }" -ge 200 ] 2>/dev/null || continue
    echo "$id ${size%% *}"
  done | sort -k2 -n | tail -1 | cut -d' ' -f1
}

# Do not start a second browser when one is already running.
existing="$(browser_window)"
if [ -n "$existing" ]; then
  log "a browser window is already open ($existing), bringing it to the front"
  xdotool windowmap "$existing" 2>/dev/null
  xdotool windowraise "$existing" 2>/dev/null
  xdotool windowactivate "$existing" 2>/dev/null
  xdotool windowfocus "$existing" 2>/dev/null
  exit 0
fi

mkdir -p "$DATA_DIR" 2>/dev/null || true
log "starting $launcher"

# Wine runs Windows programs, so the profile directory has to be a Windows path.
win_data_dir="$(winepath -w "$DATA_DIR" 2>/dev/null | tail -1)"
[ -n "$win_data_dir" ] || win_data_dir="$DATA_DIR"

cd "$SHARK_DIR" || exit 1
wine "$launcher" \
  --no-sandbox \
  --disable-gpu \
  --disable-dev-shm-usage \
  --disable-features=TranslateUI \
  --window-position=0,0 \
  --window-size=1600,900 \
  --user-data-dir="$win_data_dir" \
  about:blank >/tmp/mbl-browser.log 2>&1 &

# Give the window time to appear, then make it fill the screen.
#
# The window is sized explicitly instead of relying on the window manager rule:
# the browser resizes itself after the window manager has already placed it.
screen_size() {
  xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}'
}

for _ in $(seq 1 40); do
  sleep 0.5
  id="$(browser_window)"
  if [ -n "$id" ]; then
    xdotool windowmap "$id" 2>/dev/null
    xdotool windowraise "$id" 2>/dev/null
    xdotool windowactivate "$id" 2>/dev/null
    xdotool windowfocus "$id" 2>/dev/null

    dims="$(screen_size)"
    if [ -n "${dims:-}" ]; then
      w="${dims%x*}"
      h="${dims#*x}"
      wmctrl -i -r "$id" -e "0,0,0,${w},${h}" 2>/dev/null
      xdotool windowsize "$id" "$w" "$h" 2>/dev/null
      xdotool windowmove "$id" 0 0 2>/dev/null
    fi
    log "browser window is up ($id)"
    exit 0
  fi
done

log "the browser did not open a window in time; see /tmp/mbl-browser.log"
exit 1
