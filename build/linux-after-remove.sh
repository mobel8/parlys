#!/bin/bash
# ============================================================
# VoiceInk — Linux .deb / .rpm post-remove hook.
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
    [ -f "$d/VoiceInk.desktop" ] && rm -f "$d/VoiceInk.desktop"
  done
done < /etc/passwd

exit 0
