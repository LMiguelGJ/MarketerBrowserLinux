#!/usr/bin/env bash
# Bring a window of the shared display to the front.
#
# The application hides its own window while a profile is running, and hides it
# again when it loses the focus. A window that is unmapped is not listed by the
# window manager, so the X tree (xdotool) is used to find it and XMapWindow to
# show it again.
#
# Usage: raise-window.sh <app|browser|restore>
#   app      the application window, with the focus, so it stays visible
#   browser  a browser window of a launched profile
#   restore  the application and every browser window
set -u

export DISPLAY="${DISPLAY:-:99}"
APP_TITLE="${RECOVER_APP_TITLE:-MainForm}"
MIN_SIZE=200

usage() {
  echo "usage: raise-window.sh <app|browser|restore>" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
TARGET="$1"

geometry() {
  xwininfo -id "$1" 2>/dev/null |
    awk -F': ' '/Width:/ {w=$2} /Height:/ {h=$2} END {print w" "h}'
}

is_big_enough() {
  local size
  size="$(geometry "$1")"
  [ "${size%% *}" -ge "$MIN_SIZE" ] 2>/dev/null || return 1
  [ "${size##* }" -ge "$MIN_SIZE" ] 2>/dev/null || return 1
  return 0
}

map_state() {
  xwininfo -id "$1" 2>/dev/null | awk -F': ' '/Map State/ {print $2; exit}'
}

# Windows of the application.
app_windows() {
  local id
  for id in $(xdotool search --name "$APP_TITLE" 2>/dev/null); do
    is_big_enough "$id" && echo "$id"
  done
}

# Windows of the browsers the application launches, without the 1x1 helpers.
browser_windows() {
  local id
  for id in $(xdotool search --class 'chrome.exe' 2>/dev/null) \
             $(xdotool search --class 'Chromium' 2>/dev/null); do
    is_big_enough "$id" && echo "$id"
  done
}

show() {
  local id="$1" focus="${2:-no}"
  xdotool windowmap "$id" 2>/dev/null
  xdotool windowraise "$id" 2>/dev/null
  if [ "$focus" = "focus" ]; then
    # The application hides itself again when it loses the focus, so it has to
    # get the focus back to stay visible.
    xdotool windowactivate "$id" 2>/dev/null
    xdotool windowfocus "$id" 2>/dev/null
  fi
}

case "$TARGET" in
  app)
    found=0
    for id in $(app_windows); do
      show "$id" focus
      found=1
      break
    done
    [ "$found" -eq 1 ] || {
      echo "raise-window: no application window found" >&2
      exit 66
    }
    ;;
  browser)
    found=0
    for id in $(browser_windows); do
      show "$id" focus
      found=1
      break
    done
    [ "$found" -eq 1 ] || {
      echo "raise-window: no browser window found" >&2
      exit 66
    }
    ;;
  restore)
    for id in $(app_windows); do
      show "$id" focus
    done
    for id in $(browser_windows); do
      show "$id" nofocus
    done
    ;;
  *)
    usage
    ;;
esac
