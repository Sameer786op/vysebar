import { spawn } from "node:child_process";
import { app, ipcMain, nativeImage, shell } from "electron";
import type { Data, Pin, Settings, Toast, WinInfo } from "@shared/types";
import { getIcon, iconSource, importTaskbarPins, launchPin, launchWindowApp, pinFromPath, pinFromStartApp, startAppList, windowThumbs } from "./apps";
import { host } from "./host";
import { data, settings } from "./store";
import { refreshTopic } from "./topics";
import { searchCity } from "./services/online";
import { toast } from "./services/automations";
import { openSettings, openWidgets } from "./windows";
import { check as checkForUpdate, installNow as installUpdate, updateState } from "./updater";

// the host commands a window may ask for; taskbar and appbar control stay with the main process
const HOST_COMMANDS = new Set([
  "start", "winx", "showDesktop", "taskView", "actionCenter", "quickSettings", "snip",
  "mediaControl", "setVolume", "setAppVolume", "mixer", "audioDevices", "setAudioDevice",
  "setRadio", "setTheme", "setBrightness", "nextKeyboard", "emptyRecycleBin",
  "minimize", "maximize", "restore", "close",
  "keepAwake", "mic", "desktopIcons", "displayMode", "quickAccess", "trayClick", "jumpList", "jumpOpen", "jumpTask",
]);

// which topic to refresh after a host command changed what it shows
const REFRESH: Record<string, string> = {
  setVolume: "volume", setAudioDevice: "volume", setRadio: "radios", setTheme: "theme", setBrightness: "brightness",
  nextKeyboard: "keyboard", emptyRecycleBin: "recycle", mediaControl: "media",
  keepAwake: "switches", mic: "switches", desktopIcons: "switches",
};

// startDrag needs a non-empty icon
const EMPTY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export function applyLoginItem(): void {
  if (!app.isPackaged) return;
  app.setLoginItemSettings({ openAtLogin: settings.value.launchAtStartup, path: process.execPath });
}

export function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings.value);
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => {
    const v = settings.set(patch);
    if ("launchAtStartup" in patch) applyLoginItem();
    return v;
  });
  ipcMain.handle("data:get", () => data.value);
  ipcMain.handle("data:set", (_e, patch: Partial<Data>) => data.set(patch));
  // the same from a window that is closing (Settings shut mid-edit): answered at once, and
  // written to disk there and then
  ipcMain.on("settings:setNow", (e, patch: Partial<Settings>) => {
    settings.set(patch);
    if ("launchAtStartup" in patch) applyLoginItem();
    settings.flush();
    e.returnValue = true;
  });
  ipcMain.on("data:setNow", (e, patch: Partial<Data>) => {
    data.set(patch);
    data.flush();
    e.returnValue = true;
  });

  ipcMain.handle("host", async (_e, cmd: string, args: Record<string, unknown> = {}) => {
    if (!HOST_COMMANDS.has(cmd)) throw new Error(`not allowed: ${cmd}`);
    const r = await host.call(cmd, args);
    if (REFRESH[cmd]) refreshTopic(REFRESH[cmd]);
    return r;
  });

  ipcMain.handle("win:activate", (_e, hwnd: number, toggle = true) => host.try("activate", { hwnd, toggle }));
  ipcMain.handle("win:kill", (_e, pid: number) => host.try("kill", { pid }));
  ipcMain.handle("win:thumbs", (_e, hwnds: number[]) => windowThumbs(hwnds));
  ipcMain.handle("win:launchNew", (_e, w: WinInfo) => launchWindowApp(w));

  ipcMain.handle("pin:launch", (_e, pin: Pin) => launchPin(pin));
  ipcMain.handle("pins:fromPaths", async (_e, paths: string[], index?: number) => {
    const added = await Promise.all(paths.map((p) => pinFromPath(p)));
    const pins = [...settings.value.pins];
    pins.splice(index ?? pins.length, 0, ...added);
    settings.set({ pins });
    return added;
  });
  ipcMain.handle("pins:fromStartApp", (_e, a: { name: string; id: string }) => {
    const pin = pinFromStartApp(a);
    settings.set({ pins: [...settings.value.pins, pin] });
    return pin;
  });
  ipcMain.handle("pins:fromWindow", async (_e, w: WinInfo, name: string) => {
    const pin: Pin = { id: Math.random().toString(36).slice(2, 10), name, exe: w.exe ?? undefined };
    if (w.aumid && w.aumid.includes("!")) pin.aumid = w.aumid;
    else if (w.exe) pin.path = w.exe;
    if (w.aumid && !w.aumid.includes("!")) pin.aumid = w.aumid;
    settings.set({ pins: [...settings.value.pins, pin] });
    return pin;
  });

  // adds the taskbar's pins that the dock doesn't have yet
  ipcMain.handle("pins:importTaskbar", async () => {
    const have = new Set(settings.value.pins.map((p) => (p.exe ?? p.path ?? p.aumid ?? "").toLowerCase()));
    const fresh = (await importTaskbarPins()).filter((p) => !have.has((p.exe ?? p.path ?? p.aumid ?? "").toLowerCase()));
    settings.set({ pins: [...settings.value.pins, ...fresh] });
    return fresh.length;
  });

  ipcMain.handle("apps:start", () => startAppList());
  ipcMain.handle("icon", (_e, target: { aumid?: string; path?: string; exe?: string } | string, size = 64) =>
    getIcon(typeof target === "string" ? [target] : iconSource(target), size),
  );

  ipcMain.handle("open:path", (_e, path: string) => shell.openPath(path));
  ipcMain.handle("open:folder", (_e, path: string) => shell.showItemInFolder(path));
  ipcMain.handle("open:url", (_e, url: string) => {
    if (/^(https?|ms-settings|mailto):/i.test(url)) return shell.openExternal(url);
  });
  ipcMain.handle("files:trash", async (_e, paths: string[]) => {
    for (const p of paths) await shell.trashItem(p);
    refreshTopic("recycle");
  });
  ipcMain.handle("run", (_e, what: "taskmgr" | "explorer" | "settings" | "recycle") => {
    const exe = { taskmgr: "taskmgr.exe", explorer: "explorer.exe", settings: "explorer.exe", recycle: "explorer.exe" }[what];
    if (!exe) return;
    const args = what === "settings" ? ["ms-settings:"] : what === "recycle" ? ["shell:RecycleBinFolder"] : [];
    spawn(exe, args, { detached: true, stdio: "ignore" }).unref();
  });

  ipcMain.handle("power", (_e, what: "lock" | "sleep" | "restart" | "shutdown" | "signout") => {
    if (what === "lock" || what === "sleep") return host.try(what);
    const flag = { restart: "/r", shutdown: "/s", signout: "/l" }[what];
    if (!flag) return;
    spawn("shutdown.exe", flag === "/l" ? [flag] : [flag, "/t", "0"], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  });

  // dragging a file out of a card (a download onto an email, a screenshot into a chat)
  ipcMain.on("files:drag", (e, path: string, icon?: string) => {
    const img = icon ? nativeImage.createFromDataURL(icon) : nativeImage.createEmpty();
    e.sender.startDrag({ file: path, icon: img.isEmpty() ? nativeImage.createFromDataURL(EMPTY_PNG) : img.resize({ width: 48 }) });
  });

  ipcMain.handle("weather:search", (_e, q: string) => searchCity(q));
  ipcMain.handle("toast", (_e, t: Toast) => toast(t));
  ipcMain.handle("toast:test", () => toast({ title: "VyseBar", body: "Alerts will show up right here", icon: "bell" }));

  ipcMain.handle("window:settings", (_e, page?: string) => openSettings(page));
  ipcMain.handle("window:widgets", () => openWidgets());
  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:get", () => updateState());
  ipcMain.handle("update:check", () => checkForUpdate());
  ipcMain.handle("update:install", () => installUpdate());
  ipcMain.handle("app:quit", () => app.quit());
  ipcMain.handle("app:restart", () => {
    app.relaunch();
    app.quit();
  });
}
