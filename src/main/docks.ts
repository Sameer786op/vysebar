// One dock window per display. Each is a transparent, always-on-top strip along the screen
// edge, tall enough for the cards that open out of the dock. Only the dock and open cards
// take the mouse; everywhere else clicks fall through to the windows behind.
import { join } from "node:path";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, screen, type Display } from "electron";
import type { DockInfo, WinInfo } from "@shared/types";
import { host } from "./host";
import { isLite, markActive, trimNow } from "./perf";
import { settings } from "./store";
import { log } from "./log";

const MAX_WINDOW_H = 760;

interface Dock {
  win: BrowserWindow;
  display: Display;
  fullscreen: boolean;
  /** the renderer wants the mouse: the pointer is on the dock or a card is open */
  wants: boolean;
  /** the dock plate in window coordinates, so a file dragged from Explorer can land on it */
  plate: { x: number; y: number; width: number; height: number } | null;
  overPlate: boolean;
  /** no window is open on this dock's screen (auto-hide keeps the dock up then) */
  desktop: boolean;
}

const docks = new Map<number, Dock>();
let lastExternal = 0;

export function loadPage(win: BrowserWindow, route: string): void {
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(`${process.env.ELECTRON_RENDERER_URL}#${route}`);
  else void win.loadFile(join(import.meta.dirname, "../renderer/index.html"), { hash: route });
}

export const preloadPath = () => join(import.meta.dirname, "../preload/index.cjs");

/** Windows won't let a background app take focus on its own; the helper knows the way round */
export function bringToFront(win: BrowserWindow): void {
  win.show();
  win.focus();
  void host.try("activate", { hwnd: hwndOf(win), toggle: false });
}

function hwndOf(win: BrowserWindow): number {
  const handle = win.getNativeWindowHandle();
  return Number(handle.length >= 8 ? handle.readBigUInt64LE(0) : handle.readUInt32LE(0));
}

// follow: the screen the dock went to last, by name and place, since Windows renumbers screens
function followed(): Display | undefined {
  const f = settings.value.followDisplay;
  if (!f) return undefined;
  const all = screen.getAllDisplays();
  return all.find((d) => d.label === f.label && d.bounds.x === f.x && d.bounds.y === f.y) ?? all.find((d) => d.bounds.x === f.x && d.bounds.y === f.y);
}

function dockDisplays(): Display[] {
  const primary = screen.getPrimaryDisplay();
  if (settings.value.displays === "all") return screen.getAllDisplays();
  if (settings.value.displays === "follow") return [followed() ?? primary];
  return [primary];
}

function geometry(d: Display) {
  const b = d.bounds;
  const h = Math.min(b.height, MAX_WINDOW_H);
  return { x: b.x, y: settings.value.edge === "top" ? b.y : b.y + b.height - h, width: b.width, height: h };
}

const isGlass = () => {
  const s = settings.value;
  return s.style === "glass" || s.style === "ios" || (s.style === "clear" && s.clearTiles === "frosted");
};
// live glass reads the screen behind the dock. The helper reads it with VyseBar's own windows
// left out (the Magnification API), so the dock shows in screen shares and screenshots like the
// taskbar. Only where that doesn't work (the helper says so) does the dock keep itself out of
// captures, or the glass would show the dock inside itself. Until the helper has answered, it
// stays out of them too. Lite glass is drawn from the wallpaper file and never needs this.
let grabSkipsDock = false;
const hideFromCapture = () => isGlass() && !isLite() && !grabSkipsDock;

function setGrabSkipsDock(on: boolean): void {
  if (on !== grabSkipsDock) log(on ? "glass: reads leave the dock out, so it shows in screen shares" : "glass: the dock is kept out of screen captures");
  grabSkipsDock = on;
  for (const dock of docks.values()) if (!dock.win.isDestroyed()) dock.win.setContentProtection(hideFromCapture());
}

// a helper that crashed in the middle of a magnifier read isn't asked to use it again by this
// version of VyseBar (a new version tries once more): the old way is safe everywhere
const gdiFlag = () => join(app.getPath("userData"), "glass-gdi.txt");
function magnifierOff(): boolean {
  try {
    return readFileSync(gdiFlag(), "utf8").trim() === app.getVersion();
  } catch {
    return false;
  }
}
function magnifierDied(err: unknown): void {
  if ((err as Error)?.message !== "host crashed") return;
  log("glass: the helper crashed during a magnifier read; this version keeps the dock out of captures from now on");
  try {
    writeFileSync(gdiFlag(), app.getVersion());
  } catch {
    /* it is only a hint */
  }
  setGrabSkipsDock(false);
}
function askGrabMode(): void {
  const allow = !magnifierOff();
  host
    .call<{ excludes?: boolean }>("grabMode", { allow })
    .then((r) => setGrabSkipsDock(allow && !!r?.excludes))
    .catch((err) => (allow ? magnifierDied(err) : undefined));
}

// live glass reads the screen behind it about once a second while nothing moves; the pointer
// moving or a window changing makes it look more often for a while (pinged at most 4x a second)
let lastGlassPing = 0;
function glassActivity(): void {
  const now = Date.now();
  if (now - lastGlassPing < 250 || !isGlass() || isLite()) return;
  lastGlassPing = now;
  for (const d of docks.values()) if (!d.win.isDestroyed()) d.win.webContents.send("glass:activity");
}

function applyMouse(dock: Dock): void {
  if (dock.win.isDestroyed()) return;
  dock.win.setIgnoreMouseEvents(!(dock.wants || dock.overPlate), { forward: true });
}

function createDock(d: Display): Dock {
  const win = new BrowserWindow({
    ...geometry(d),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    // never takes focus from the app you're in, like the taskbar; cards that need typing ask for it
    focusable: false,
    hasShadow: false,
    thickFrame: false,
    roundedCorners: false,
    show: false,
    title: "VyseBar",
    webPreferences: {
      preload: preloadPath(),
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });
  win.setAlwaysOnTop(true, "pop-up-menu");
  win.setIgnoreMouseEvents(true, { forward: true });
  // the glass reads the screen behind the dock; the dock must not see itself in it
  win.setContentProtection(hideFromCapture());
  loadPage(win, `dock?display=${d.id}`);
  win.once("ready-to-show", () => win.showInactive());
  const dock: Dock = { win, display: d, fullscreen: false, wants: false, plate: null, overPlate: false, desktop: false };
  // a dock page that crashed (a GPU driver reset, the PC waking up) comes back by itself
  win.webContents.on("render-process-gone", (_e, why) => {
    if (why.reason === "clean-exit") return;
    setTimeout(() => !win.isDestroyed() && loadPage(win, `dock?display=${dock.display.id}`), 1000);
  });
  win.webContents.on("did-finish-load", () => {
    if (dock.desktop) win.webContents.send("dock:desktop", true);
  });
  win.on("closed", () => {
    if (docks.get(dock.display.id)?.win === win) docks.delete(dock.display.id);
  });
  return dock;
}

export function dockInfo(win: BrowserWindow): DockInfo | null {
  for (const dock of docks.values()) {
    if (dock.win === win) {
      return {
        displayId: dock.display.id,
        primary: dock.display.id === screen.getPrimaryDisplay().id,
        bounds: dock.display.bounds,
        windowHeight: win.getBounds().height,
      };
    }
  }
  return null;
}

function reserve(dock: Dock): void {
  const s = settings.value;
  const id = String(dock.display.id);
  if (s.autoHide || s.floatOver) {
    void host.try("removeAppbar", { id });
    return;
  }
  const phys = screen.dipToScreenRect(null, dock.display.bounds);
  const thickness = Math.round((s.size + s.distance) * dock.display.scaleFactor);
  void host.try("appbar", { id, top: s.edge === "top", ...phys, thickness });
}

export function layoutDocks(): void {
  const wanted = dockDisplays();
  const ids = new Set(wanted.map((d) => d.id));
  // a following dock moves its window to the other screen rather than starting a new one
  if (wanted.length === 1 && docks.size === 1 && !docks.has(wanted[0].id)) {
    const [[oldId, dock]] = [...docks];
    void host.try("removeAppbar", { id: String(oldId) });
    docks.delete(oldId);
    docks.set(wanted[0].id, dock);
  }
  for (const [id, dock] of docks) {
    if (!ids.has(id)) {
      void host.try("removeAppbar", { id: String(id) });
      dock.win.destroy();
      docks.delete(id);
    }
  }
  for (const d of wanted) {
    let dock = docks.get(d.id);
    if (!dock) {
      dock = createDock(d);
      docks.set(d.id, dock);
    } else {
      dock.display = d;
      dock.win.setBounds(geometry(d));
      dock.win.webContents.send("dock:info", dockInfo(dock.win));
    }
    dock.win.setContentProtection(hideFromCapture());
    reserve(dock);
  }
}

let relayoutTimer: NodeJS.Timeout | null = null;
function relayoutSoon(): void {
  if (relayoutTimer) clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(layoutDocks, 400);
}

export function applyTaskbar(): void {
  const s = settings.value;
  if (s.hideTaskbar) void host.try("hideTaskbar", { mode: s.taskbarMode });
  else void host.try("restoreTaskbar");
  // while the dock is the taskbar, Win+1...9 and Win+T are its keys; otherwise Explorer keeps them
  void host.try("keys", { win: s.hideTaskbar && s.winKeys, altT: s.altT });
}

/** auto-hide's "show on desktop": tells each dock whether its screen has no window open */
let lastWindows: WinInfo[] = [];
function checkDesktop(): void {
  const s = settings.value;
  for (const dock of docks.values()) {
    const phys = screen.dipToScreenRect(null, dock.display.bounds);
    const open = lastWindows.some((w) => {
      if (w.minimized || w.x === undefined || w.y === undefined || !w.w || !w.h) return false;
      const cx = w.x + w.w / 2;
      const cy = w.y + w.h / 2;
      return cx >= phys.x && cx < phys.x + phys.width && cy >= phys.y && cy < phys.y + phys.height;
    });
    const desktop = s.autoHide && s.showOnDesktop && !open;
    if (desktop === dock.desktop) continue;
    dock.desktop = desktop;
    if (!dock.win.isDestroyed()) dock.win.webContents.send("dock:desktop", desktop);
  }
}

/** after sleep: the window is back where it belongs, drawn again, its space kept clear */
function wakeDocks(): void {
  for (const dock of docks.values()) {
    if (dock.win.isDestroyed()) continue;
    if (dock.win.webContents.isCrashed()) {
      loadPage(dock.win, `dock?display=${dock.display.id}`);
      continue;
    }
    dock.win.setBounds(geometry(dock.display));
    dock.win.setAlwaysOnTop(true, "pop-up-menu");
    if (!dock.fullscreen) dock.win.showInactive();
    dock.win.webContents.invalidate();
    dock.win.webContents.send("dock:info", dockInfo(dock.win));
    reserve(dock);
  }
  applyTaskbar();
}

/** Win+n goes to the dock on the main screen, like the Windows taskbar's keys */
function hotkeyDock(): Dock | undefined {
  const primary = screen.getPrimaryDisplay().id;
  return docks.get(primary) ?? docks.values().next().value;
}

export function allDocks(): BrowserWindow[] {
  return [...docks.values()].map((d) => d.win);
}

export function initDocks(): void {
  layoutDocks();
  // the helper is usually up by now, so its "ready" has already gone by
  applyTaskbar();
  screen.on("display-added", relayoutSoon);
  screen.on("display-removed", relayoutSoon);
  screen.on("display-metrics-changed", relayoutSoon);

  settings.onChange((v, prev) => {
    if (
      v.edge !== prev.edge ||
      v.size !== prev.size ||
      v.distance !== prev.distance ||
      v.displays !== prev.displays ||
      v.autoHide !== prev.autoHide ||
      v.floatOver !== prev.floatOver ||
      v.style !== prev.style ||
      v.clearTiles !== prev.clearTiles ||
      v.performance !== prev.performance
    ) {
      layoutDocks();
    }
    if (v.hideTaskbar !== prev.hideTaskbar || v.taskbarMode !== prev.taskbarMode || v.winKeys !== prev.winKeys || v.altT !== prev.altT) applyTaskbar();
    if (v.autoHide !== prev.autoHide || v.showOnDesktop !== prev.showOnDesktop || v.displays !== prev.displays) checkDesktop();
  });

  // Win+T: the arrows, Tab, Enter and Esc step through the dock's apps (see Hotkeys.cs)
  let navOn = false;
  host.on("nav", (n: { key: string }) => {
    const dock = hotkeyDock();
    if (!dock || dock.win.isDestroyed()) return;
    markActive();
    const ending = n.key === "enter" || n.key === "esc" || n.key === "cancel";
    if (settings.value.autoHide) {
      if (!ending) dock.win.webContents.send("dock:reveal");
      else setTimeout(() => !dock.win.isDestroyed() && !dock.overPlate && dock.win.webContents.send("dock:conceal"), 1200);
    }
    navOn = !ending;
    dock.win.webContents.send("dock:nav", n);
  });

  // Alt+T: the To-do card, wherever you are
  host.on("shortcut", (k: { name: string }) => {
    const dock = hotkeyDock();
    if (!dock || dock.win.isDestroyed()) return;
    markActive();
    if (settings.value.autoHide) dock.win.webContents.send("dock:reveal");
    dock.win.webContents.send("dock:shortcut", k.name);
  });

  // after the PC sleeps or is locked, the dock is put back instead of leaving an empty strip
  const wake = () => setTimeout(wakeDocks, 1500);
  powerMonitor.on("resume", wake);
  powerMonitor.on("unlock-screen", wake);

  host.on("hotkey", (k: { index: number; mode: string }) => {
    const dock = hotkeyDock();
    if (!dock || dock.win.isDestroyed()) return;
    markActive();
    // an auto-hidden dock comes up for a moment so you can see which app it was
    if (settings.value.autoHide) {
      dock.win.webContents.send("dock:reveal");
      setTimeout(() => !dock.win.isDestroyed() && !dock.overPlate && dock.win.webContents.send("dock:conceal"), 1800);
    }
    dock.win.webContents.send("dock:hotkey", k);
  });

  host.on("ready", () => {
    applyTaskbar();
    for (const dock of docks.values()) reserve(dock);
    askGrabMode();
  });
  // a new helper reads with GDI until it's asked: keep the dock out of captures till then
  host.on("restarted", () => setGrabSkipsDock(false));
  // the helper gave up on the magnifier (it stopped answering)
  host.on("grabMode", (m: { excludes?: boolean }) => setGrabSkipsDock(!!m?.excludes && !magnifierOff()));
  host.on("explorerRestarted", () => {
    applyTaskbar();
    for (const dock of docks.values()) reserve(dock);
  });

  host.on("windows", (list: WinInfo[]) => {
    glassActivity();
    lastWindows = Array.isArray(list) ? list : [];
    checkDesktop();
  });
  // the Windows key: Start or Search opening brings an auto-hidden dock up, and it goes once they close
  let startShown = false;
  host.on("foreground", (f: { hwnd: number; app: boolean; exe?: string | null }) => {
    glassActivity();
    // another app coming up (a click somewhere, Alt+Tab) ends Win+T, as on the taskbar
    if (navOn && f.app) {
      navOn = false;
      void host.try("navEnd");
      hotkeyDock()?.win.webContents.send("dock:nav", { key: "cancel" });
    }
    if (f.app) lastExternal = f.hwnd;
    for (const dock of docks.values()) dock.win.webContents.send("foreground", f);
    if (!settings.value.autoHide) return;
    const start = /(StartMenuExperienceHost|SearchHost|SearchApp)\.exe$/i.test(f.exe ?? "");
    if (start || startShown) for (const dock of docks.values()) dock.win.webContents.send(start ? "dock:reveal" : "dock:conceal");
    startShown = start;
  });

  // a fullscreen game or video gets the whole screen; the dock stops drawing under it
  host.on("fullscreen", (rect: { x: number; y: number; width: number; height: number } | null) => {
    const dip = rect ? screen.screenToDipRect(null, rect) : null;
    const target = dip ? screen.getDisplayMatching(dip) : null;
    for (const dock of docks.values()) {
      const full = !!target && target.id === dock.display.id;
      if (full === dock.fullscreen) continue;
      dock.fullscreen = full;
      if (full) {
        dock.win.hide();
        // a game or video has the screen: the dock's memory is better off with it
        trimNow();
      } else dock.win.showInactive();
    }
  });

  // follow: holding the pointer against the dock's edge of another screen brings the dock there
  let followAt: { id: number; since: number } | null = null;
  setInterval(() => {
    if (settings.value.displays !== "follow") return void (followAt = null);
    const p = screen.getCursorScreenPoint();
    const d = screen.getDisplayNearestPoint(p);
    const b = d.bounds;
    const atEdge = settings.value.edge === "top" ? p.y <= b.y + 1 : p.y >= b.y + b.height - 2;
    const current = docks.values().next().value?.display.id;
    if (!atEdge || d.id === current) return void (followAt = null);
    if (!followAt || followAt.id !== d.id) return void (followAt = { id: d.id, since: Date.now() });
    if (Date.now() - followAt.since < 450) return;
    followAt = null;
    settings.set({ followDisplay: { label: d.label, x: b.x, y: b.y } });
    layoutDocks();
  }, 100);

  // auto-hide: the pointer touching the screen edge brings the dock back
  setInterval(() => {
    if (!settings.value.autoHide) return;
    const p = screen.getCursorScreenPoint();
    for (const dock of docks.values()) {
      const b = dock.display.bounds;
      if (p.x < b.x || p.x >= b.x + b.width) continue;
      const atEdge = settings.value.edge === "top" ? p.y <= b.y + 1 : p.y >= b.y + b.height - 2;
      if (atEdge) dock.win.webContents.send("dock:reveal");
    }
  }, 120);

  ipcMain.handle("dock:info", (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return win ? dockInfo(win) : null;
  });

  const dockOf = (e: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    return [...docks.values()].find((d) => d.win === win);
  };

  ipcMain.on("dock:interactive", (e, on: boolean) => {
    const dock = dockOf(e);
    if (!dock) return;
    dock.wants = on;
    if (on) markActive();
    applyMouse(dock);
  });

  // peek at a window while its preview is hovered (null ends it); the dock stays on top of the
  // peek, and the helper ends it by itself once the pointer leaves the dock
  ipcMain.on("dock:peek", (e, hwnd: number | null) => {
    const dock = dockOf(e);
    if (!hwnd || !dock || dock.win.isDestroyed() || !settings.value.peek) return void host.try("peek", { on: false });
    const r = screen.dipToScreenRect(dock.win, dock.win.getBounds());
    void host.try("peek", { on: true, hwnd, top: hwndOf(dock.win), x: r.x, y: r.y, w: r.width, h: r.height });
  });

  ipcMain.on("dock:plate", (e, rect: Dock["plate"]) => {
    const dock = dockOf(e);
    if (dock) dock.plate = rect;
  });

  // an Explorer drag sends no mouse moves to a click-through window, so the pointer is
  // watched here and the dock takes the mouse while it is over the plate
  let lastCursor = { x: -1, y: -1 };
  setInterval(() => {
    const p = screen.getCursorScreenPoint();
    if (p.x !== lastCursor.x || p.y !== lastCursor.y) {
      lastCursor = p;
      glassActivity();
    }
    for (const dock of docks.values()) {
      if (!dock.plate || dock.win.isDestroyed() || !dock.win.isVisible()) continue;
      const b = dock.win.getBounds();
      const r = dock.plate;
      const over = p.x >= b.x + r.x && p.x <= b.x + r.x + r.width && p.y >= b.y + r.y - 4 && p.y <= b.y + r.y + r.height + 4;
      if (over !== dock.overPlate) {
        dock.overPlate = over;
        applyMouse(dock);
      }
    }
  }, 60);

  // a card with a text field needs keyboard focus; giving it back returns focus to your app
  ipcMain.on("dock:focus", (e, on: boolean) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    if (!win) return;
    markActive();
    if (on) {
      win.setFocusable(true);
      bringToFront(win);
    } else if (win.isFocusable()) {
      const hadFocus = win.isFocused();
      win.setFocusable(false);
      if (hadFocus && lastExternal) void host.try("activate", { hwnd: lastExternal, toggle: false });
    }
  });

  // live glass: the strip of screen behind the glass, read by the helper (Grab.cs) a few
  // times a second and scaled down there; rows are CSS pixels of the dock window
  ipcMain.handle("dock:grab", async (e, req: { top: number; bottom: number; scale: number }) => {
    const dock = dockOf(e);
    if (!dock || dock.win.isDestroyed() || !isGlass() || isLite()) return null;
    const b = dock.win.getBounds();
    const top = Math.max(0, Math.min(b.height - 1, Math.floor(req.top)));
    const bottom = Math.max(top + 1, Math.min(b.height, Math.ceil(req.bottom)));
    const r = screen.dipToScreenRect(dock.win, { x: b.x, y: b.y + top, width: b.width, height: bottom - top });
    const s = Math.min(1, Math.max(0.1, Number(req.scale) || 0.25));
    const ow = Math.max(1, Math.round(r.width * s));
    const oh = Math.max(1, Math.round(r.height * s));
    const viaMagnifier = grabSkipsDock;
    let g: { w: number; h: number; data: string } | null = null;
    try {
      g = await host.call<{ w: number; h: number; data: string } | null>("grab", { x: r.x, y: r.y, w: r.width, h: r.height, ow, oh });
    } catch (err) {
      if (viaMagnifier) magnifierDied(err);
      return null;
    }
    return g ? { w: g.w, h: g.h, top, bottom, data: Buffer.from(g.data, "base64") } : null;
  });
  ipcMain.on("dock:grabRelease", () => void host.try("grabRelease"));

  // lite glass: the wallpaper as Windows fills it onto the display, cut to this dock's window
  ipcMain.handle("dock:wallpaperRegion", (e) => {
    const dock = dockOf(e);
    const transcoded = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
    if (!dock || !existsSync(transcoded)) return null;
    const img = nativeImage.createFromBuffer(readFileSync(transcoded));
    if (img.isEmpty()) return null;
    const d = dock.display.bounds;
    const wb = dock.win.getBounds();
    const top = Math.max(0, wb.y - d.y);
    const { width: iw, height: ih } = img.getSize();
    const k = Math.max(d.width / iw, d.height / ih);
    const x = Math.max(0, Math.round((iw * k - d.width) / 2 / k));
    const y = Math.max(0, Math.round(((ih * k - d.height) / 2 + top) / k));
    const part = img
      .crop({ x, y, width: Math.min(iw - x, Math.round(d.width / k)), height: Math.min(ih - y, Math.round(wb.height / k)) })
      .resize({ width: d.width, height: wb.height, quality: "good" });
    return { url: `data:image/jpeg;base64,${part.toJPEG(85).toString("base64")}`, crop: { x: 0, y: top, w: d.width, h: wb.height } };
  });

  ipcMain.handle("dock:wallpaper", () => {
    const transcoded = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
    if (!existsSync(transcoded)) return null;
    const img = nativeImage.createFromBuffer(readFileSync(transcoded));
    if (img.isEmpty()) return null;
    return img.resize({ width: 1920 }).toDataURL();
  });
}
