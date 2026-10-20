#!/usr/bin/env bash
# Never leave the shared display empty, and honour the window controls.
#
# The application hides its own window (ShowWindow) when it launches a profile:
# the browser becomes the visible surface. The operator can then minimise the
# browser or close the application, and each of those actions would leave the
# shared screen black with no way back, because the application window is
# unmapped rather than iconised and the window manager no longer advertises it.
#
# This watchdog keeps one surface on screen:
#
#   * a browser window the operator minimised is brought back;
#   * an application that was closed is opened again;
#   * when nothing is mapped, the application window is restored.
#
# Windows are found through the X tree (xdotool), not through the window
# manager: an unmapped window disappears from the window manager's list, so
# wmctrl cannot be used to find the window that has to be brought back. The
# application is looked up by class, not by title: while it shows a modal box
# its main window can be renamed.
#
# Only windows with a real size are considered: the browsers create dozens of
# 1x1 helper windows that would otherwise be restored and raised pointlessly.
#
# Environment:
#   DISPLAY           (default :99)
#   RECOVER_INTERVAL  seconds between checks (default 2)
#   MBL_APP_CLASS     class of the application window (default marketerbrowserlite.exe)
#   MBL_APP_DIR       where the application is started from (default /opt/mbl-app)
set -u

export DISPLAY="${DISPLAY:-:99}"
INTERVAL="${RECOVER_INTERVAL:-2}"
APP_CLASS="${MBL_APP_CLASS:-marketerbrowserlite.exe}"
APP_DIR="${MBL_APP_DIR:-/opt/mbl-app}"
BROWSER_CLASSES="${MBL_BROWSER_CLASSES:-chrome.exe Chromium}"
MIN_SIZE=200

# Geometry of a window: "WIDTH HEIGHT".
geometry() {
  xwininfo -id "$1" 2>/dev/null |
    awk -F': ' '/Width:/ {w=$2} /Height:/ {h=$2} END {print w" "h}'
}

map_state() {
  xwininfo -id "$1" 2>/dev/null | awk -F': ' '/Map State/ {print $2; exit}'
}

is_big_enough() {
  local size
  size="$(geometry "$1")"
  [ "${size%% *}" -ge "$MIN_SIZE" ] 2>/dev/null || return 1
  [ "${size##* }" -ge "$MIN_SIZE" ] 2>/dev/null || return 1
  return 0
}

# The application window, by class.
app_windows() {
  local id
  for id in $(xdotool search --class "$APP_CLASS" 2>/dev/null); do
    is_big_enough "$id" && echo "$id"
  done
}

# The main browser window: the one that carries a title.
browser_windows() {
  local id cls name size named=""
  for cls in $BROWSER_CLASSES; do
    for id in $(xdotool search --class "$cls" 2>/dev/null); do
      is_big_enough "$id" || continue
      name="$(xdotool getwindowname "$id" 2>/dev/null)"
      case "$name" in
        *Chromium* | *"Google Chrome"*)
          echo "$id"
          return 0
          ;;
      esac
      [ -n "$named" ] || named="$id"
    done
  done
  [ -n "$named" ] && echo "$named"
  return 0
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
  echo "recover-windows: restored the application window ($id)"
}

restore_browser() {
  local id="$1"
  wmctrl -i -a "$id" 2>/dev/null
  xdotool windowmap "$id" 2>/dev/null
  xdotool windowraise "$id" 2>/dev/null
  echo "recover-windows: restored the browser window ($id)"
}

# The application was closed: start it again, in place, so the browser of a
# running profile keeps its session.
reopen_app() {
  echo "recover-windows: the application was closed, starting it again"
  cd "$APP_DIR" 2>/dev/null || return 1
  wine MarketerBrowserLite.exe >/tmp/mbl-app.log 2>&1 &
}

app_running() {
  pgrep -f MarketerBrowserLite.exe >/dev/null 2>&1
}

while :; do
  app_id="$(app_windows | head -1)"
  browser_id="$(browser_windows | head -1)"

  # What is on screen right now.
  visible=0
  for id in "$app_id" "$browser_id"; do
    [ -n "$id" ] || continue
    [ "$(map_state "$id")" = "IsViewable" ] && visible=1
  done

  if [ "$visible" -eq 0 ]; then
    # Nothing on screen. A browser the operator minimised comes back: the
    # application hides itself by design, so a minimised browser would leave
    # the screen empty.
    if [ -n "$browser_id" ] && [ "$(map_state "$browser_id")" = "IsIconic" ]; then
      restore_browser "$browser_id"
    elif [ -n "$app_id" ]; then
      restore_app "$app_id"
    elif [ -n "$browser_id" ]; then
      restore_browser "$browser_id"
    fi
  fi

  # The application was closed: open it again, in place, so the browser of a
  # running profile keeps its session.
  if [ -z "$app_id" ] && ! app_running; then
    reopen_app
  fi

  # A browser window restores its own saved bounds shortly after it opens, so
  # its size is enforced on every pass. The focus is left alone: the
  # application hides itself when it loses the focus, and a minimised window
  # keeps the size the operator gave it.
  bash "$HERE/raise-window.sh" browser-size >/dev/null 2>&1 || true

  sleep "$INTERVAL"
done
