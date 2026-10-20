#!/usr/bin/env bash
# Keep two known start-up windows of the application out of the way.
#
# At start the application can show:
#   1. an update prompt ("The new version of v... has been downloaded!"). It is modal
#      and blocks the main window until it is answered or times out, so Cancel is pressed;
#   2. an error box about a failed helper process. In .NET that box belongs to an
#      unhandled exception on a background thread: the process only stays alive while
#      the box is open and DIES when OK is pressed. It is therefore never clicked,
#      only minimized.
#
# Windows are recognised by their exact size, only during the first
# DISMISS_WINDOW_SECONDS after start, and each is handled at most three times, so a
# dialog the user opens later is left alone.
#
# Environment:
#   DISPLAY                  (default :99)
#   DISMISS_INTERVAL         seconds between scans            (default 2)
#   DISMISS_WINDOW_SECONDS   how long to keep watching        (default 300)
set -u

export DISPLAY="${DISPLAY:-:99}"
INTERVAL="${DISMISS_INTERVAL:-2}"
WATCH_FOR="${DISMISS_WINDOW_SECONDS:-300}"

declare -A tries
start="$(date +%s)"

while :; do
  now="$(date +%s)"
  [ $((now - start)) -gt "$WATCH_FOR" ] && { echo "dismiss-dialogs: watch period over"; exit 0; }

  while read -r id w h; do
    case "${w}x${h}" in
      477x377)
        what="update prompt (Cancel)"
        action=(xdotool mousemove --window "$id" 421 351 click 1)
        ;;
      429x570)
        what="helper error box (minimized, never clicked)"
        action=(xdotool windowminimize "$id")
        ;;
      *) continue ;;
    esac
    n="${tries[$id]:-0}"
    [ "$n" -ge 3 ] && continue
    tries[$id]=$((n + 1))
    if "${action[@]}" 2>/dev/null; then
      echo "dismiss-dialogs: $what on window $id"
    fi
  done < <(wmctrl -lG 2>/dev/null | awk '{print $1, $5, $6}')

  sleep "$INTERVAL"
done
