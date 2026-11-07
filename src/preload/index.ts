import { contextBridge, ipcRenderer, webFrame, webUtils } from "electron";

// the same tests as main/perf.ts, from what a sandboxed preload can see
const memKb = process.getSystemMemoryInfo().total;
const build = Number(process.getSystemVersion().split(".")[2] ?? 0);


const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args),
  send: (channel: string, ...args: unknown[]): void => ipcRenderer.send(channel, ...args),
  /** only for a window that is closing: an ordinary message sent then can be dropped */
  sendSync: (channel: string, ...args: unknown[]): unknown => ipcRenderer.sendSync(channel, ...args),
  on: (channel: string, fn: (...args: any[]) => void): (() => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ...args: unknown[]) => fn(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
  /** a dropped file's path on disk */
  pathOf: (file: File): string => webUtils.getPathForFile(file),
  /** 32-bit Windows or 4 GB of RAM or less; and whether this is Windows 11 */
  env: { lowEnd: process.arch === "ia32" || memKb <= 4.5 * 1024 * 1024, win11: build >= 22000 },
};

// main says the dock has been idle: drop decoded images and collect garbage before the
// working set is handed back to Windows
ipcRenderer.on("vyse:idle", () => {
  webFrame.clearCache();
  (globalThis as { gc?: () => void }).gc?.();
});

// main checks that the page still answers; a page stuck in a script can't, and is reloaded
ipcRenderer.on("vyse:ping", () => ipcRenderer.send("vyse:pong"));

contextBridge.exposeInMainWorld("vyse", api);

export type VyseApi = typeof api;
