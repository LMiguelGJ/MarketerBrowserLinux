#!/usr/bin/env bash
# Show the last thing the application logged, on the shared display.
#
# When a profile fails to start, the application hides its own window and shows
# nothing useful: the shared screen turns black and the reason stays in its log
# file. This reads that file and puts the last lines on screen, so the operator
# sees why instead of a black canvas.
#
# Environment:
#   DISPLAY           (default :99)
#   MBL_LOG_DIR      where the application writes its logs (default /data/Logs)
set -u

export DISPLAY="${DISPLAY:-:99}"
LOG_DIR="${MBL_LOG_DIR:-/data/Logs}"

newest_log() {
  find "$LOG_DIR" -type f -name '*.log' 2>/dev/null | sort | tail -1
}

log_file="$(newest_log)"
if [ -z "$log_file" ]; then
  xmessage -center -buttons 1 -default okay \
    "MarketerBrowserLite\n\nNo hay registros en $LOG_DIR." 2>/dev/null
  exit 66
fi

# The last lines, with the newest first, trimmed to what fits on screen.
tail_text="$(tail -n 12 "$log_file" 2>/dev/null)"
if [ -z "$tail_text" ]; then
  xmessage -center -buttons 1 -default okay \
    "MarketerBrowserLite\n\nEl registro $log_file esta vacio." 2>/dev/null
  exit 66
fi

xmessage -center -buttons 1 -default okay -width 900 \
  "MarketerBrowserLite - ultimo registro ($log_file)\n\n$tail_text" 2>/dev/null
