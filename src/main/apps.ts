// Pinned apps and open windows, grouped one icon per app the way the taskbar does.
import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { app, shell } from "electron";
import type { AppItem, Pin, WinInfo } from "@shared/types";
import { host } from "./host";
import { settings } from "./store";
import { defineTopic, publish } from "./topics";

let windows: WinInfo[] = [];
let startApps: { name: string; id: string }[] = [];
const iconCache = new Map<string, string>();
const nameCache = new Map<string, string>();
const iconFile = join(app.getPath("userData"), "icon-cache.json");
const firstSeen = new Map<string, number>();
let seenCounter = 0;

try {
  const saved = JSON.parse(readFileSync(iconFile, "utf8")) as Record<string, string>;
  for (const [k, v] of Object.entries(saved)) iconCache.set(k, v);
} catch {
  /* no cache yet */
}
let iconSaveTimer: NodeJS.Timeout | null = null;
function saveIcons(): void {
  if (iconSaveTimer) return;
  iconSaveTimer = setTimeout(() => {
    iconSaveTimer = null;
    writeFileSync(iconFile, JSON.stringify(Object.fromEntries(iconCache)));
  }, 2000);
}

// Start lists Win32 apps by a known-folder GUID path; this turns those back into real paths
const knownFolders: Record<string, string | undefined> = {
  "{6D809377-6AF0-444B-8957-A3773F02200E}": process.env.ProgramW6432 ?? process.env.ProgramFiles,
  "{7C5A40EF-A0FB-4BFC-874A-C0F2E0B9FA8E}": process.env["ProgramFiles(x86)"],
  "{905E63B6-C1BF-494E-B29C-65B732D3D21A}": process.env.ProgramFiles,
  "{F38BF404-1D43-42F2-9305-67DE0B28FC23}": process.env.WINDIR,
  "{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}": join(process.env.WINDIR ?? "C:\\Windows", "System32"),
  "{D65231B0-B2F1-4857-A4CE-A8E7C6EA7D27}": join(process.env.WINDIR ?? "C:\\Windows", "SysWOW64"),
  "{F1B32785-6FBA-4FCF-9D55-7B8E7F157091}": process.env.LOCALAPPDATA,
  "{3EB685DB-65F9-4CF6-A03A-E3EF65729F3D}": process.env.APPDATA,
  "{5E6C858F-0E22-4760-9AFE-EA3317B67173}": process.env.USERPROFILE,
};

export function resolveAumidPath(id: string): string | null {
  const m = /^(\{[0-9A-F-]+\})\\(.+)$/i.exec(id);
  if (m) {
    const base = knownFolders[m[1].toUpperCase()];
    return base ? join(base, m[2]) : null;
  }
  if (/^[a-z]:\\/i.test(id)) return id;
  return null;
}

const norm = (s: string | null | undefined) => (s ? s.toLowerCase() : "");

function windowKeys(w: WinInfo): string[] {
  const keys: string[] = [];
  if (w.aumid) keys.push("aumid:" + norm(w.aumid));
  if (w.exe) {
    keys.push("exe:" + norm(w.exe));
    // Squirrel installs (Discord, Slack...) run from an app-1.2.3 folder; their shortcut points one level up
    const squirrel = w.exe.replace(/\\app-[\d.]+\\([^\\]+)$/i, "\\$1");
    if (squirrel !== w.exe) keys.push("exe:" + norm(squirrel));
  }
  return keys;
}

function pinKeys(p: Pin): string[] {
  const keys: string[] = [];
  if (p.aumid) keys.push("aumid:" + norm(p.aumid));
  if (p.exe) keys.push("exe:" + norm(p.exe));
  else if (p.path && extname(p.path).toLowerCase() === ".exe") keys.push("exe:" + norm(p.path));
  return keys;
}

function groupKey(w: WinInfo): string {
  return w.aumid ? "aumid:" + norm(w.aumid) : "exe:" + norm(w.exe);
}

/** where an icon can come from, best first: a pinned shortcut, the Start entry, the .exe */
export function iconSource(target: { aumid?: string | null; path?: string | null; exe?: string | null }): string[] {
  const out: string[] = [];
  if (target.path) out.push(target.path);
  if (target.aumid) out.push(resolveAumidPath(target.aumid) ?? "shell:AppsFolder\\" + target.aumid);
  if (target.exe) out.push(target.exe);
  return out;
}

export async function getIcon(sources: string[] | string | null, size = 64): Promise<string | undefined> {
  const list = Array.isArray(sources) ? sources : sources ? [sources] : [];
  for (const source of list) {
    const key = `${size}|${source.toLowerCase()}`;
    const hit = iconCache.get(key);
    if (hit) return hit;
    const icon = await host.try<string | null>("icon", { path: source, size });
    if (icon) {
      iconCache.set(key, icon);
      saveIcons();
      return icon;
    }
  }
  // last resort for files the shell can't make an item for
  for (const source of list) {
    if (!/^[a-z]:\\/i.test(source)) continue;
    try {
      const url = (await app.getFileIcon(source, { size: "large" })).toDataURL();
      iconCache.set(`${size}|${source.toLowerCase()}`, url);
      return url;
    } catch {
      /* no icon */
    }
  }
  return undefined;
}

async function nameFor(w: WinInfo): Promise<string> {
  const key = groupKey(w);
  const hit = nameCache.get(key);
  if (hit) return hit;
  let name: string | null = null;
  if (w.aumid) name = startApps.find((a) => norm(a.id) === norm(w.aumid))?.name ?? null;
  if (!name && w.exe) {
    name = startApps.find((a) => norm(resolveAumidPath(a.id)) === norm(w.exe))?.name ?? null;
    if (!name) name = await host.try<string | null>("exeName", { path: w.exe });
    if (!name) name = basename(w.exe, extname(w.exe));
  }
  name = name || w.title || "App";
  nameCache.set(key, name);
  return name;
}

let computing = false;
let again = false;
export async function publishApps(): Promise<void> {
  if (computing) {
    again = true;
    return;
  }
  computing = true;
  try {
    publish("apps", await computeApps());
  } finally {
    computing = false;
    if (again) {
      again = false;
      void publishApps();
    }
  }
}

async function computeApps(): Promise<AppItem[]> {
  const pins = settings.value.pins;
  const items: AppItem[] = [];
  const claimed = new Set<number>();

  for (const pin of pins) {
    if (pin.group) {
      const icons = await Promise.all(pin.group.items.slice(0, 4).map((p) => getIcon(iconSource(p), 32)));
      items.push({
        key: "group:" + pin.id,
        name: pin.group.name,
        icon: JSON.stringify(icons.filter(Boolean)),
        pinned: true,
        pin,
        windows: [],
        active: false,
        flashing: false,
      });
      continue;
    }
    const keys = new Set(pinKeys(pin));
    const wins = windows.filter((w) => !claimed.has(w.hwnd) && windowKeys(w).some((k) => keys.has(k)));
    wins.forEach((w) => claimed.add(w.hwnd));
    items.push({
      key: "pin:" + pin.id,
      name: pin.name,
      icon: await getIcon(iconSource(pin)),
      pinned: true,
      pin,
      windows: wins,
      active: wins.some((w) => w.active),
      flashing: wins.some((w) => w.flashing),
    });
  }

  const groups = new Map<string, WinInfo[]>();
  for (const w of windows) {
    if (claimed.has(w.hwnd)) continue;
    const k = groupKey(w);
    if (!firstSeen.has(k)) firstSeen.set(k, seenCounter++);
    const list = groups.get(k) ?? [];
    list.push(w);
    groups.set(k, list);
  }
  const running = [...groups.entries()].sort((a, b) => firstSeen.get(a[0])! - firstSeen.get(b[0])!);
  for (const [key, wins] of running) {
    const w = wins[0];
    items.push({
      key: "run:" + key,
      name: await nameFor(w),
      icon: await getIcon(iconSource({ aumid: w.aumid, exe: w.exe })),
      pinned: false,
      windows: wins,
      active: wins.some((x) => x.active),
      flashing: wins.some((x) => x.flashing),
    });
  }
  return items;
}

export function initApps(): void {
  defineTopic("apps", {
    start() {
      void publishApps();
    },
    refresh() {
      void publishApps();
    },
  });
  host.on("windows", (list: WinInfo[]) => {
    windows = list;
    void publishApps();
  });
  host.on("ready", () => {
    // Start's app list tells which app ID an .exe has, for recent files in app menus; read it
    // once things have settled
    setTimeout(() => void host.try("jumpWarm"), 8000);
    void host.try<WinInfo[]>("windows").then((list) => {
      if (list) windows = list;
      void publishApps();
    });
  });
  settings.onChange((v, prev) => {
    if (v.pins !== prev.pins) void publishApps();
  });
  void loadStartApps();
}

export async function loadStartApps(): Promise<{ name: string; id: string }[]> {
  const list = await host.try<{ name: string; id: string }[]>("startApps", {}, 30_000);
  if (list) startApps = list.sort((a, b) => a.name.localeCompare(b.name));
  return startApps;
}

export async function startAppList(): Promise<{ name: string; id: string; icon?: string }[]> {
  if (!startApps.length) await loadStartApps();
  return startApps.filter((a) => !/uninstall|readme|help|documentation|website/i.test(a.name));
}

// ---------- pins ----------

const uid = () => Math.random().toString(36).slice(2, 10);

export async function pinFromPath(path: string): Promise<Pin> {
  const ext = extname(path).toLowerCase();
  const pin: Pin = { id: uid(), name: basename(path, ext), path };
  if (ext === ".lnk") {
    try {
      const link = shell.readShortcutLink(path);
      if (link.target) pin.exe = link.target;
      if (link.args) pin.args = link.args;
    } catch {
      /* a shortcut to a Store app has no target */
    }
    const aumid = await host.try<string | null>("fileAumid", { path });
    if (aumid) pin.aumid = aumid;
  } else if (ext === ".exe") {
    pin.exe = path;
    pin.name = (await host.try<string | null>("exeName", { path })) || pin.name;
  }
  return pin;
}

export function pinFromStartApp(a: { name: string; id: string }): Pin {
  const path = resolveAumidPath(a.id);
  if (path) return { id: uid(), name: a.name, path, exe: path, aumid: a.id };
  return { id: uid(), name: a.name, aumid: a.id };
}

/** first run: the apps pinned to the Windows taskbar become the dock's pins */
export async function importTaskbarPins(): Promise<Pin[]> {
  const dir = join(process.env.APPDATA ?? "", "Microsoft", "Internet Explorer", "Quick Launch", "User Pinned", "TaskBar");
  const pins: Pin[] = [];
  if (existsSync(dir)) {
    for (const f of readdirSync(dir)) {
      if (!f.toLowerCase().endsWith(".lnk")) continue;
      pins.push(await pinFromPath(join(dir, f)));
    }
  }
  if (!pins.some((p) => norm(p.exe).endsWith("\\explorer.exe") || norm(p.aumid) === "microsoft.windows.explorer")) {
    const explorer = join(process.env.WINDIR ?? "C:\\Windows", "explorer.exe");
    pins.unshift({ id: uid(), name: "File Explorer", path: explorer, exe: explorer });
  }
  return pins;
}

export function launchPin(pin: Pin): void {
  if (pin.aumid && !pin.path) {
    spawn("explorer.exe", ["shell:AppsFolder\\" + pin.aumid], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (!pin.path) return;
  if (pin.args && extname(pin.path).toLowerCase() === ".exe") {
    spawn(pin.path, pin.args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((a) => a.replace(/^"|"$/g, "")) ?? [], {
      detached: true,
      stdio: "ignore",
    }).unref();
    return;
  }
  void shell.openPath(pin.path);
}

/** opens a new window of a running app that has no pin */
export function launchWindowApp(w: WinInfo): void {
  if (w.aumid && w.aumid.includes("!")) {
    spawn("explorer.exe", ["shell:AppsFolder\\" + w.aumid], { detached: true, stdio: "ignore" }).unref();
  } else if (w.exe) {
    spawn(w.exe, [], { detached: true, stdio: "ignore" }).unref();
  }
}

// ---------- window previews ----------

// drawn by the helper (Thumbs.cs), only for the windows the popup shows; a window that can't
// be drawn right now (minimized) keeps its last picture
const thumbCache = new Map<number, { at: number; url: string }>();
let thumbQueue: Promise<unknown> = Promise.resolve();
export function windowThumbs(hwnds: number[]): Promise<Record<number, string>> {
  const run = thumbQueue.then(async () => {
    const now = Date.now();
    const stale = hwnds.filter((h) => now - (thumbCache.get(h)?.at ?? 0) > 1500);
    if (stale.length) {
      const got = await host.try<Record<string, string>>("thumbs", { hwnds: stale, w: 400, h: 250 });
      for (const h of stale) {
        const url = got?.[String(h)];
        if (url) thumbCache.set(h, { at: Date.now(), url });
      }
      // closed windows don't linger
      if (thumbCache.size > 48) for (const k of [...thumbCache.keys()].slice(0, thumbCache.size - 48)) thumbCache.delete(k);
    }
    const out: Record<number, string> = {};
    for (const h of hwnds) {
      const t = thumbCache.get(h);
      if (t) out[h] = t.url;
    }
    return out;
  });
  thumbQueue = run.catch(() => undefined);
  return run;
}
