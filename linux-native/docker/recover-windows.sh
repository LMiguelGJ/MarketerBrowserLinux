#!/usr/bin/env bash
# Never leave the shared display empty.
#
# The application hides its own window (ShowWindow) when it launches a profile:
# the browser becomes the visible surface. If that browser window is then
# minimised, no window is left mapped and the shared screen turns completely
# black with no way back, because the application window is unmapped rather
# than iconised and the window manager no longer advertises it.
#
# This watchdog restores the application window whenever the display would be
# empty. Windows are found through the X tree (xdotool), not through the window
# manager: an unmapped window disappears from the window manager's list, so
# wmctrl cannot be used to find the window that has to be brought back.
#
# Only windows with a real size are considered: the browsers create dozens of
# 1x1 helper windows that would otherwise be restored and raised pointlessly.
#
# Environment:
#   DISPLAY           (default :99)
#   RECOVER_INTERVAL  seconds between checks (default 2)
#   MBL_APP_CLASS     class of the application window (default marketerbrowserlite.exe)
set -u

export DISPLAY="${DISPLAY:-:99}"
INTERVAL="${RECOVER_INTERVAL:-2}"
APP_CLASS="${MBL_APP_CLASS:-marketerbrowserlite.exe}"
MIN_SIZE=200

# Geometry of a window: "WIDTH HEIGHT".
geometry() {
  xwininfo -id "$1" 2>/dev/null |
    awk -F': ' '/Width:/ {w=$2} /Height:/ {h=$2} END {print w" "h}'
}

map_state() {
  xwininfo -id "$1" 2>/dev/null | awk -F': ' '/Map State/ {print $2; exit}'
}

# The application window and the browsers it launches, without the 1x1 helpers.
# The application is found by class, not by title: while it shows a modal box its
# main window can be renamed, and a title search would then find nothing.
candidate_windows() {
  local id size
  for id in $(xdotool search --class "$APP_CLASS" 2>/dev/null) \
             $(xdotool search --class 'chrome.exe' 2>/dev/null) \
             $(xdotool search --class 'Chromium' 2>/dev/null); do
    size="$(geometry "$id")"
    [ "${size%% *}" -ge "$MIN_SIZE" ] 2>/dev/null || continue
    [ "${size##* }" -ge "$MIN_SIZE" ] 2>/dev/null || continue
    echo "$id"
  done
}

# The application hides itself when it loses the focus, so restoring it means
# giving it the focus back as well: a window that is mapped but unfocused is
# hidden again by the application on the next focus change.
restore_app() {
  local id="$1"
  xdotool windowmap "$id" 2>/dev/null
  xdotool windowraise "$id" 2>/dev/null
  xdotool windowactivate "$id" 2>/dev/null
  xdotool windowfocus "$id" 2>/dev/null
  echo "recover-windows: the display was empty, restored the application window ($id)"
}

restore_browser() {
  local id="$1"
  xdotool windowmap "$id" 2>/dev/null
  xdotool windowraise "$id" 2>/dev/null
  echo "recover-windows: the display was empty, restored a browser window ($id)"
}

while :; do
  mapfile -t ids < <(candidate_windows)

  visible=0
  for id in "${ids[@]:-}"; do
    [ -n "$id" ] || continue
    [ "$(map_state "$id")" = "IsViewable" ] && visible=1
  done

  if [ "$visible" -eq 0 ] && [ "${#ids[@]}" -gt 0 ]; then
    # The application first, and it keeps the focus: the operator gets back to
    # the management screen and it stays there. A browser window is only
    # restored when there is no application window to fall back to.
    restored=0
    for id in "${ids[@]:-}"; do
      [ -n "$id" ] || continue
      class="$(xprop -id "$id" WM_CLASS 2>/dev/null | head -1)"
      case "$class" in
        *"$APP_CLASS"*)
          restore_app "$id"
          restored=1
          break
          ;;
      esac
    done
    if [ "$restored" -eq 0 ]; then
      for id in "${ids[@]:-}"; do
        [ -n "$id" ] || continue
        restore_browser "$id"
        break
      done
    fi
  fi

  sleep "$INTERVAL"
done
