#!/usr/bin/env bash
# Serve the virtual display to a browser tab.
#
#   browser ──WebSocket(token)──► websockify :6080 ──► x11vnc 127.0.0.1:5900 ──► Xvfb
#
# x11vnc listens only on 127.0.0.1 and has no password of its own: the single
# way in is websockify, which refuses any connection that does not carry a
# valid token.
#
# Environment:
#   MBL_ACCESS_TOKEN  required, 16-128 chars of [A-Za-z0-9_-]
#   DISPLAY           display to share        (default :99)
#   WEB_PORT          browser-facing port     (default 6080)
#   VNC_PORT          local VNC port          (default 5900)
#   NOVNC_DIR         noVNC files             (default /usr/share/novnc)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [ -z "${MBL_ACCESS_TOKEN:-}" ]; then
  echo "MBL_ACCESS_TOKEN is required. Generate one with: openssl rand -hex 24" >&2
  exit 64
fi
if ! [[ "$MBL_ACCESS_TOKEN" =~ ^[A-Za-z0-9_-]{16,128}$ ]]; then
  echo "MBL_ACCESS_TOKEN must be 16-128 characters from [A-Za-z0-9_-]" >&2
  exit 64
fi

DISPLAY="${DISPLAY:-:99}"
WEB_PORT="${WEB_PORT:-6080}"
VNC_PORT="${VNC_PORT:-5900}"
NOVNC_DIR="${NOVNC_DIR:-/usr/share/novnc}"
export DISPLAY

[ -f "$NOVNC_DIR/core/rfb.js" ] || { echo "noVNC not found in $NOVNC_DIR" >&2; exit 1; }

STAGE="$(mktemp -d)"
TOKENS="$STAGE/tokens"
umask 077
printf '%s: 127.0.0.1:%s\n' "$MBL_ACCESS_TOKEN" "$VNC_PORT" >"$TOKENS"

# Static files: our page plus noVNC's modules under /novnc.
cp "$HERE/web/index.html" "$HERE/web/app.js" "$STAGE/"
ln -s "$NOVNC_DIR" "$STAGE/novnc"

x11vnc -display "$DISPLAY" -localhost -rfbport "$VNC_PORT" \
  -forever -shared -nopw -noxdamage -quiet >/tmp/x11vnc.log 2>&1 &
VNC_PID=$!

for _ in $(seq 1 100); do
  (exec 3<>"/dev/tcp/127.0.0.1/$VNC_PORT") 2>/dev/null && break
  kill -0 "$VNC_PID" 2>/dev/null || { echo "x11vnc exited:" >&2; cat /tmp/x11vnc.log >&2; exit 1; }
  sleep 0.1
done

exec websockify --web "$STAGE" \
  --token-plugin TokenFile --token-source "$TOKENS" \
  "0.0.0.0:$WEB_PORT"
