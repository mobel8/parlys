#!/bin/bash
# ============================================================
# Parlys — Linux .deb / .rpm post-remove hook.
# Clean up the per-user desktop shortcuts we dropped on install.
# ============================================================

set -e

while IFS=: read -r _ _ uid _ _ home shell; do
  [ "$uid" -lt 1000 ] && continue
  [ "$uid" -ge 65000 ] && continue
  case "$shell" in
    */nologin|*/false|"") continue ;;
  esac
  [ -z "$home" ] && continue

  for d in "$home/Desktop" "$home/Bureau"; do
    [ -f "$d/Parlys.desktop" ] && rm -f "$d/Parlys.desktop"
  done
done < /etc/passwd

exit 0
