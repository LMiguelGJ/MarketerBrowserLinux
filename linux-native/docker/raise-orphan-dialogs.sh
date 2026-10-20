#!/usr/bin/env bash
# Keep the application's dialogs visible.
#
# The application opens some message boxes as transient windows of an invisible
# helper window. A window manager stacks a transient window above its parent, but
# this parent is not on screen, so the dialog ends up at the very bottom, under the
# main window, and the application looks frozen behind an invisible modal.
#
# Each such window is raised once into the "above" layer. Normal windows, such as
# the ones of the profile browsers, are left alone, so they never cover the
# application permanently.
#
# Environment:
#   DISPLAY   (default :99)
#   RAISE_INTERVAL   seconds between scans (default 0.5)
set -u

export DISPLAY="${DISPLAY:-:99}"
INTERVAL="${RAISE_INTERVAL:-0.5}"

declare -A seen

while :; do
  managed="$(wmctrl -l 2>/dev/null | awk '{print $1}')"

  for id in $managed; do
    [ -n "${seen[$id]:-}" ] && continue
    seen[$id]=1

    parent="$(xprop -id "$id" WM_TRANSIENT_FOR 2>/dev/null | sed -n 's/.*# \(0x[0-9a-fA-F]*\).*/\1/p')"
    [ -z "$parent" ] && continue

    normalized="$(printf '0x%08x' "$((parent))")"
    if ! grep -qix "$normalized" <<<"$managed"; then
      wmctrl -i -r "$id" -b add,above 2>/dev/null \
        && echo "raise-orphan-dialogs: raised window $id (its parent $normalized is not on screen)"
    fi
  done

  sleep "$INTERVAL"
done
