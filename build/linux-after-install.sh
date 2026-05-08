#!/bin/bash
# ============================================================
# VoiceInk — Linux .deb / .rpm post-install hook.
#
# electron-builder runs this after the package has written its
# files to /opt/VoiceInk and /usr/share/applications/voiceink.desktop.
#
# We additionally copy the .desktop launcher onto every existing
# user's Desktop (and also add a per-user symlink, so the icon
# shows up immediately without them having to log out/in first).
# ============================================================

set -e

DESKTOP_SRC="/usr/share/applications/voiceink.desktop"

if [ ! -f "$DESKTOP_SRC" ]; then
  exit 0
fi

# Make every launcher marked as a trusted application (GNOME, KDE).
chmod +x "$DESKTOP_SRC" || true

# Walk every real user on the machine (UID >= 1000, has a shell)
# and drop the launcher onto their Desktop if that folder exists.
while IFS=: read -r username _ uid _ _ home shell; do
  [ "$uid" -lt 1000 ] && continue
  [ "$uid" -ge 65000 ] && continue
  case "$shell" in
    */nologin|*/false|"") continue ;;
  esac
  [ -z "$home" ] && continue
  [ ! -d "$home" ] && continue

  # Localised "Desktop" path (XDG). Fallback to ~/Desktop or ~/Bureau.
  desktop_dir=""
  if [ -f "$home/.config/user-dirs.dirs" ]; then
    # shellcheck disable=SC1090
    desktop_dir="$(XDG_CONFIG_HOME="$home/.config" bash -c 'source "$HOME/.config/user-dirs.dirs"; echo "$XDG_DESKTOP_DIR"' 2>/dev/null | sed "s|\$HOME|$home|g")"
  fi
  [ -z "$desktop_dir" ] && [ -d "$home/Desktop" ] && desktop_dir="$home/Desktop"
  [ -z "$desktop_dir" ] && [ -d "$home/Bureau" ]  && desktop_dir="$home/Bureau"
  [ -z "$desktop_dir" ] && continue
  [ ! -d "$desktop_dir" ] && continue

  target="$desktop_dir/VoiceInk.desktop"
  cp -f "$DESKTOP_SRC" "$target"
  chown "$uid:$uid" "$target" 2>/dev/null || true
  chmod +x "$target" 2>/dev/null || true

  # GNOME: mark as trusted so the icon doesn't show with a ? overlay.
  if command -v gio >/dev/null 2>&1; then
    su - "$username" -c "gio set '$target' metadata::trusted true" 2>/dev/null || true
  fi
done < /etc/passwd

# Refresh the icon cache so the menu entry shows up with its icon
# without requiring a logout.
if command -v update-desktop-database >/dev/null 2>&1; then
  update-desktop-database -q /usr/share/applications 2>/dev/null || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
  gtk-update-icon-cache -qtf /usr/share/icons/hicolor 2>/dev/null || true
fi

exit 0
