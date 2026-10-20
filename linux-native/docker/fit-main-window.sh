#!/usr/bin/env bash
# Keep the application's main window filling the whole screen.
#
# The window manager sizes the window when it first appears, but the application
# restores its own saved window size right after, so on any start with existing
# data it ends up smaller than the screen. This script watches the main window
# (titled "MainForm") and puts it back to full screen whenever it is not.
#
# Environment:
#   DISPLAY        (default :99)
#   FIT_INTERVAL   seconds between checks (default 1)
set -u

export DISPLAY="${DISPLAY:-:99}"
INTERVAL="${FIT_INTERVAL:-1}"

screen_size() {
  xdpyinfo 2>/dev/null | awk '/dimensions:/ {print $2; exit}'
}

while :; do
  read -r sw sh < <(screen_size | tr 'x' ' ')
  if [ -n "${sw:-}" ]; then
    # wmctrl -lG: id desktop x y w h host title...
    while read -r id _ _ _ w h _ title; do
      [ "$title" = "MainForm" ] || continue
      if [ "$w" != "$sw" ] || [ "$h" != "$sh" ]; then
        wmctrl -i -r "$id" -b add,fullscreen 2>/dev/null \
          && echo "fit-main-window: ${w}x${h} -> ${sw}x${sh} (window $id)"
      fi
    done < <(wmctrl -lG 2>/dev/null)
  fi
  sleep "$INTERVAL"
done
