import { Tray, Menu, nativeImage, BrowserWindow, app } from 'electron';
import { join } from 'path';
import { existsSync } from 'fs';
import { IPC } from '../shared/types';

let tray: Tray | null = null;

export function createTray(getWin: () => BrowserWindow | null): Tray {
  const iconPath = resolveIconPath();
  let image: Electron.NativeImage;
  try {
    image = nativeImage.createFromPath(iconPath);
    if (image.isEmpty()) image = nativeImage.createEmpty();
  } catch {
    image = nativeImage.createEmpty();
  }

  tray = new Tray(image);
  tray.setToolTip('VoiceInk — Dictée IA');

  const menu = Menu.buildFromTemplate([
    {
      label: 'Afficher VoiceInk',
      click: () => {
        const w = getWin();
        if (w) { w.show(); w.focus(); }
      },
    },
    {
      label: 'Démarrer / Arrêter dictée',
      click: () => {
        const w = getWin();
        // Do not show/focus the window: otherwise the auto-injection paste
        // would land in VoiceInk itself instead of the user's current app.
        if (w) w.webContents.send(IPC.ON_TOGGLE_RECORDING);
      },
    },
    { type: 'separator' },
    {
      label: 'Quitter',
      click: () => {
        (app as any).isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
  tray.on('click', () => {
    const w = getWin();
    if (!w) return;
    if (w.isVisible()) w.hide();
    else { w.show(); w.focus(); }
  });
  return tray;
}

function resolveIconPath(): string {
  const candidates = [
    join(process.resourcesPath || '', 'assets', 'icon.png'),
    join(__dirname, '..', '..', 'assets', 'icon.png'),
    join(__dirname, '..', '..', 'assets', 'icon.svg'),
    join(process.cwd(), 'assets', 'icon.png'),
    join(process.cwd(), 'assets', 'icon.svg'),
  ];
  for (const c of candidates) {
    if (c && existsSync(c)) return c;
  }
  return '';
}
