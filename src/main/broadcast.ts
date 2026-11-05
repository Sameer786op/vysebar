import { BrowserWindow } from "electron";

/** sends to every VyseBar window: docks, Settings and the widget picker */
export function broadcast(channel: string, ...args: unknown[]): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, ...args);
  }
}
