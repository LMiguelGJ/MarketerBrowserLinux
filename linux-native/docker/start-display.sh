#!/usr/bin/env bash
# Start the virtual display and the window manager.
#
# Environment:
#   DISPLAY  X display to create            (default :99)
#   SCREEN   Xvfb screen geometry WxHxDepth (default 1600x900x24)
#   OPENBOX_RC  Openbox configuration file  (default: openbox-rc.xml next to this script)
#   COMPOSITOR  "xcompmgr" (default) or "none"
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DISPLAY="${DISPLAY:-:99}"
SCREEN="${SCREEN:-1600x900x24}"
OPENBOX_RC="${OPENBOX_RC:-$HERE/openbox-rc.xml}"
export DISPLAY

if ! [[ "$SCREEN" =~ ^[0-9]{3,4}x[0-9]{3,4}x(16|24|32)$ ]]; then
  echo "SCREEN must look like 1600x900x24, got: $SCREEN" >&2
  exit 64
fi

# TCP is disabled: the display is only reachable through the local socket.
Xvfb "$DISPLAY" -screen 0 "$SCREEN" -nolisten tcp >/tmp/xvfb.log 2>&1 &
XVFB_PID=$!

socket="/tmp/.X11-unix/X${DISPLAY#:}"
for _ in $(seq 1 50); do
  [ -S "$socket" ] && break
  kill -0 "$XVFB_PID" 2>/dev/null || { echo "Xvfb exited early:" >&2; cat /tmp/xvfb.log >&2; exit 1; }
  sleep 0.1
done
[ -S "$socket" ] || { echo "Xvfb did not create $socket" >&2; exit 1; }

openbox --sm-disable --config-file "$OPENBOX_RC" >/tmp/openbox.log 2>&1 &
OPENBOX_PID=$!
sleep 0.5
kill -0 "$OPENBOX_PID" 2>/dev/null || { echo "openbox exited early:" >&2; cat /tmp/openbox.log >&2; exit 1; }

# A compositor makes semi-transparent windows render as they do on Windows. The
# application dims its main window behind side panels with such a window; without a
# compositor it shows up as solid black.
COMPOSITOR_PID="-"
if [ "${COMPOSITOR:-xcompmgr}" = "xcompmgr" ] && command -v xcompmgr >/dev/null 2>&1; then
  xcompmgr >/tmp/xcompmgr.log 2>&1 &
  COMPOSITOR_PID=$!
  sleep 0.3
  kill -0 "$COMPOSITOR_PID" 2>/dev/null || { echo "xcompmgr exited early:" >&2; cat /tmp/xcompmgr.log >&2; COMPOSITOR_PID="-"; }
fi

echo "display ready: DISPLAY=$DISPLAY screen=$SCREEN xvfb=$XVFB_PID openbox=$OPENBOX_PID compositor=$COMPOSITOR_PID"
