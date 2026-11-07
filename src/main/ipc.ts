import { spawn } from "node:child_process";
import { existsSync, type Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { app, BrowserWindow, clipboard, dialog, ipcMain, nativeImage, shell } from "electron";
import type { Data, Pin, Settings, Toast, WinInfo } from "@shared/types";
import { getIcon, iconSource, importTaskbarPins, launchPin, launchWindowApp, pinFromPath, pinFromStartApp, startAppList, startProgram, windowThumbs } from "./apps";
import { host } from "./host";
import { data, settings } from "./store";
import { refreshTopic } from "./topics";
import { searchCity } from "./services/online";
import { toast } from "./services/automations";
import { openSettings, openWidgets } from "./windows";
import { check as checkForUpdate, installNow as installUpdate, updateState } from "./updater";
import { log } from "./log";

// the host commands a window may ask for; taskbar and appbar control stay with the main process
const HOST_COMMANDS = new Set([
  "start", "winx", "showDesktop", "taskView", "actionCenter", "quickSettings", "snip",
  "mediaControl", "setVolume", "setAppVolume", "mixer", "audioDevices", "setAudioDevice",
  "setRadio", "setTheme", "setBrightness", "nextKeyboard", "emptyRecycleBin",
  "minimize", "maximize", "restore", "close",
  "keepAwake", "mic", "desktopIcons", "displayMode", "quickAccess", "trayClick", "jumpList", "jumpOpen", "jumpTask",
  "setMic", "micDevices", "energySaver", "dnd", "camera", "hotspot",
]);

// which topics to refresh after a host command changed what they show
const REFRESH: Record<string, string[]> = {
  setVolume: ["volume"], setAudioDevice: ["volume", "mic"], setRadio: ["radios", "bluetooth"], setTheme: ["theme"], setBrightness: ["brightness"],
  nextKeyboard: ["keyboard"], emptyRecycleBin: ["recycle"], mediaControl: ["media"],
  keepAwake: ["switches"], mic: ["switches", "mic"], setMic: ["mic", "switches"], desktopIcons: ["switches"],
  energySaver: ["switches"], dnd: ["switches"], camera: ["switches"], hotspot: ["switches"],
};

// startDrag needs a non-empty icon
const EMPTY_PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

// Windows starts VyseBar at sign-in with --login, so a sign-in start that finds VyseBar already
// running (opened by hand before Windows got to it) steps aside without opening Settings
export const LOGIN_FLAG = "--login";

/** fromSettings: the switch in Settings was just flipped, rather than VyseBar starting */
export function applyLoginItem(fromSettings = false): void {
  if (!app.isPackaged) return;
  const path = process.execPath;
  const args = [LOGIN_FLAG];
  if (!settings.value.launchAtStartup) {
    app.setLoginItemSettings({ openAtLogin: false, path, args });
    return;
  }
  if (!fromSettings) {
    const now = app.getLoginItemSettings({ path, args });
    // already right: left alone, so VyseBar switched off under Task Manager › Startup apps stays off
    if (now.openAtLogin) return;
    // an older entry (without --login) that is switched off there stays off, and as it was
    if (now.launchItems?.some((i) => i.name === "app.vysebar" && i.scope === "user" && !i.enabled)) return;
  }
  app.setLoginItemSettings({ openAtLogin: true, path, args });
}

export function registerIpc(): void {
  ipcMain.handle("settings:get", () => settings.value);
  ipcMain.handle("settings:set", (_e, patch: Partial<Settings>) => {
    const v = settings.set(patch);
    if ("launchAtStartup" in patch) applyLoginItem(true);
    return v;
  });
  ipcMain.handle("data:get", () => data.value);
  ipcMain.handle("data:set", (_e, patch: Partial<Data>) => data.set(patch));
  // the same from a window that is closing (Settings shut mid-edit): answered at once, and
  // written to disk there and then
  ipcMain.on("settings:setNow", (e, patch: Partial<Settings>) => {
    settings.set(patch);
    if ("launchAtStartup" in patch) applyLoginItem(true);
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
    for (const t of REFRESH[cmd] ?? []) refreshTopic(t);
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
  // how to start an app from Start, for an App widget (not added to the dock's pins)
  ipcMain.handle("apps:pinFor", (_e, a: { name: string; id: string }) => pinFromStartApp(a));
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
    startProgram(exe, args);
  });

  ipcMain.handle("power", (_e, what: "lock" | "sleep" | "restart" | "shutdown" | "signout") => {
    if (what === "lock" || what === "sleep") return host.try(what);
    const flag = { restart: "/r", shutdown: "/s", signout: "/l" }[what];
    if (!flag) return;
    const child = spawn("shutdown.exe", flag === "/l" ? [flag] : [flag, "/t", "0"], { detached: true, stdio: "ignore", windowsHide: true });
    child.on("error", (err) => log(`couldn't ${what}: ${(err as NodeJS.ErrnoException).code ?? err.message}`));
    child.unref();
  });

  // dragging a file out of a card (a download onto an email, a screenshot into a chat)
  ipcMain.on("files:drag", (e, path: string, icon?: string) => {
    const img = icon ? nativeImage.createFromDataURL(icon) : nativeImage.createEmpty();
    e.sender.startDrag({ file: path, icon: img.isEmpty() ? nativeImage.createFromDataURL(EMPTY_PNG) : img.resize({ width: 48 }) });
  });

  // a folder of your choice, for a Folder widget
  ipcMain.handle("dialog:folder", async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    const opts = { title: "Choose a folder for the dock", properties: ["openDirectory" as const] };
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    const path = r.canceled ? null : r.filePaths[0];
    return path ? { path, name: basename(path) || path } : null;
  });

  // what's in a folder, for its stack: newest first, hidden and system files left out
  ipcMain.handle("folder:list", async (_e, path: string) => {
    const items: { name: string; path: string; dir: boolean; mtime: number; size: number }[] = [];
    let names: Dirent[];
    try {
      names = await readdir(path, { withFileTypes: true });
    } catch {
      return null;
    }
    await Promise.all(
      names
        .filter((d) => !d.name.startsWith(".") && !/^(desktop\.ini|thumbs\.db|\$recycle\.bin)$/i.test(d.name))
        .slice(0, 400)
        .map(async (d) => {
          const p = join(path, d.name);
          try {
            const st = await stat(p);
            items.push({ name: d.name, path: p, dir: st.isDirectory(), mtime: st.mtimeMs, size: st.size });
          } catch {
            /* gone or locked */
          }
        }),
    );
    return items.sort((a, b) => b.mtime - a.mtime);
  });

  // the text in a screenshot, read on this PC by Windows' own OCR and put on the clipboard
  ipcMain.handle("ocr:copy", async (_e, path: string) => {
    if (!/\.(png|jpe?g|bmp|gif|tiff?)$/i.test(path ?? "") || !existsSync(path)) throw new Error("not a picture");
    const text = await host.call<string>("ocr", { path }, 30_000);
    if (text) clipboard.writeText(text);
    return text ?? "";
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
  ipcMain.handle("app:quit", () => {
    log("Quit chosen in VyseBar");
    app.quit();
  });
  ipcMain.handle("app:restart", () => {
    log("Restart chosen in VyseBar");
    app.relaunch();
    app.quit();
  });
}
