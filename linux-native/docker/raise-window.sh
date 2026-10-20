#!/usr/bin/env bash
# Bring a window of the shared display to the front.
#
# The application hides its own window while a profile is running, and hides it
# again when it loses the focus. A window that is unmapped is not listed by the
# window manager, so the X tree (xdotool) is used to find it and XMapWindow to
# show it again.
#
# The windows are found by class, not by title: while the application shows a
# modal error box its main window can be renamed, and a title search would then
# find nothing at all.
#
# Usage: raise-window.sh <app|browser|dialog|restore>
#   app      the application window, with the focus, so it stays visible
#   browser  a browser window of a launched profile
#   dialog   a message box of the application
#   restore  the application and every browser window
set -u

export DISPLAY="${DISPLAY:-:99}"
APP_CLASS="${MBL_APP_CLASS:-marketerbrowserlite.exe}"
APP_TITLE="${RECOVER_APP_TITLE:-MainForm}"
BROWSER_CLASSES="${MBL_BROWSER_CLASSES:-chrome.exe Chromium}"
MIN_SIZE=200

usage() {
  echo "usage: raise-window.sh <app|browser|dialog|restore>" >&2
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

window_title() {
  xdotool getwindowname "$1" 2>/dev/null
}

# Windows of the application, largest first.
app_windows() {
  local id size
  for id in $(xdotool search --class "$APP_CLASS" 2>/dev/null); do
    is_big_enough "$id" && echo "$id $(geometry "$id")"
  done | sort -k2 -t' ' | awk '{print $1}'
}

# The message boxes of the application: they are smaller than the main window
# and carry no title, so they are told apart by size.
dialog_windows() {
  local id size
  for id in $(xdotool search --class "$APP_CLASS" 2>/dev/null); do
    size="$(geometry "$id")"
    case "$size" in
      1x1* | *x1) continue ;;
    esac
    echo "$id $size"
  done | sort -k2 -t' ' | awk '{print $1}'
}

browser_windows() {
  local id cls
  for cls in $BROWSER_CLASSES; do
    for id in $(xdotool search --class "$cls" 2>/dev/null); do
      is_big_enough "$id" && echo "$id"
    done
  done
}

# Show a window and give it the focus. The application hides itself again when
# it loses the focus, so the focus is part of showing it.
show() {
  local id="$1" focus="${2:-no}"
  xdotool windowmap "$id" 2>/dev/null
  xdotool windowraise "$id" 2>/dev/null
  if [ "$focus" = "focus" ]; then
    xdotool windowactivate "$id" 2>/dev/null
    xdotool windowfocus "$id" 2>/dev/null
  fi
}

case "$TARGET" in
  app)
    found=0
    for id in $(app_windows); do
      if [ "$(window_title "$id")" = "$APP_TITLE" ]; then
        show "$id" focus
        found=1
        break
      fi
    done
    # The main window can be renamed while the application shows a modal box.
    if [ "$found" -eq 0 ]; then
      for id in $(app_windows); do
        show "$id" focus
        found=1
        break
      done
    fi
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
  dialog)
    found=0
    for id in $(dialog_windows); do
      show "$id" focus
      found=1
      break
    done
    [ "$found" -eq 1 ] || {
      echo "raise-window: no application dialog found" >&2
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
