// One dock window per display. Each is a transparent, always-on-top strip along the screen
// edge, tall enough for the cards that open out of the dock. Only the dock and open cards
// take the mouse; everywhere else clicks fall through to the windows behind.
import { join } from "node:path";
import { readFileSync, writeFileSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { app, BrowserWindow, ipcMain, nativeImage, powerMonitor, screen, type Display } from "electron";
import type { DockInfo, WinInfo } from "@shared/types";
import { host } from "./host";
import { isLite, markActive, trimNow } from "./perf";
import { settings } from "./store";
import { log } from "./log";
import { chooseRepair, coverName, judgePoint, Ladder, noteMove, type Deaf, type PointInfo, type Repair, type Verdict } from "./pointerHealth";

const MAX_WINDOW_H = 760;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Dock {
  win: BrowserWindow;
  display: Display;
  fullscreen: boolean;
  /** the renderer wants the mouse: the pointer is on the dock or a card is open */
  wants: boolean;
  /** where the dock takes the mouse, in window coordinates: the plate, and an open card, menu or toasts */
  hits: Rect[];
  /** the pointer is over one of them, as main sees it */
  overHit: boolean;
  /** no window is open on this dock's screen (auto-hide keeps the dock up then) */
  desktop: boolean;
  /** when the page last said it heard the pointer */
  heardAt: number;
  /** pointer moves over the window that its page hasn't heard */
  deaf: Deaf | null;
  born: number;
}

const docks = new Map<number, Dock>();
let lastExternal = 0;
let quitting = false;
app.on("before-quit", () => (quitting = true));

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

// tests can run a dock off the screen, out of the way of your pointer (never in an installed VyseBar)
const testShift = app.isPackaged ? 0 : Number(process.env.VYSE_TEST_DOCK_DY) || 0;

function geometry(d: Display) {
  const b = d.bounds;
  const h = Math.min(b.height, MAX_WINDOW_H);
  return { x: b.x, y: (settings.value.edge === "top" ? b.y : b.y + b.height - h) + testShift, width: b.width, height: h };
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
  dock.win.setIgnoreMouseEvents(!(dock.wants || dock.overHit), { forward: true });
}

/** a page that is gone or starting over takes no mouse until it says where again */
function forget(dock: Dock): void {
  dock.hits = [];
  dock.wants = false;
  dock.overHit = false;
  dock.deaf = null;
  applyMouse(dock);
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
  // a game or video that already has this screen keeps it
  win.once("ready-to-show", () => !dock.fullscreen && win.showInactive());
  const dock: Dock = { win, display: d, fullscreen: false, wants: false, hits: [], overHit: false, desktop: false, heardAt: 0, deaf: null, born: Date.now() };
  win.on("unresponsive", () => log("the dock isn't taking input"));
  win.on("responsive", () => log("the dock is taking input again"));
  // Alt+F4 while a card has the keyboard would close the dock for good; like the taskbar, it
  // only goes away when VyseBar quits
  win.on("close", (e) => {
    if (!quitting) e.preventDefault();
  });
  // a dock page that crashed (a GPU driver reset, the PC waking up) comes back by itself, in a
  // new window: Electron's mouse hook would go on pointing at the dead page's part of this one
  win.webContents.on("render-process-gone", (_e, why) => {
    forget(dock);
    if (why.reason === "clean-exit") return;
    setTimeout(() => recreateDock(dock, `the dock page ended (${why.reason})`), 1000);
  });
  win.webContents.on("did-start-loading", () => forget(dock));
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
  // a dock that moved to another screen, or a new one, follows that screen's fullscreen state
  applyFullscreen();
}

// a fullscreen game or video gets the whole screen; the dock stops drawing under it
let fullRect: Electron.Rectangle | null = null;
function applyFullscreen(): void {
  const target = fullRect ? screen.getDisplayMatching(fullRect) : null;
  for (const dock of docks.values()) {
    if (dock.win.isDestroyed()) continue;
    const full = !!target && target.id === dock.display.id;
    if (full === dock.fullscreen) continue;
    dock.fullscreen = full;
    if (full) {
      dock.win.hide();
      // a game or video has the screen: the dock's memory is better off with it
      trimNow();
    } else dock.win.showInactive();
  }
}

// ---- a dock page that stops answering ----
// A script stuck in a loop, or a renderer that hung, leaves a dock that is drawn but takes no
// clicks: nothing on it works, Quit included. Each dock page is asked every few seconds (the
// preload answers); one that hasn't answered for half a minute is ended, and comes back by itself
const lastPong = new Map<number, number>();
function watchPages(): void {
  ipcMain.on("vyse:pong", (e) => lastPong.set(e.sender.id, Date.now()));
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    // the PC slept, or VyseBar's own thread was held up: the pages get a fresh start
    const skipped = now - lastTick > 20_000;
    lastTick = now;
    for (const dock of docks.values()) {
      if (dock.win.isDestroyed()) continue;
      const wc = dock.win.webContents;
      const last = lastPong.get(wc.id);
      if (skipped || last === undefined || wc.isLoading() || wc.isCrashed()) lastPong.set(wc.id, now);
      else if (now - last > 30_000) {
        lastPong.set(wc.id, now);
        log("the dock page stopped answering for 30 s: reloading it");
        wc.forcefullyCrashRenderer();
        continue;
      }
      wc.send("vyse:ping");
    }
  }, 5000);
}

let relayoutTimer: NodeJS.Timeout | null = null;
function relayoutSoon(): void {
  if (relayoutTimer) clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(() => {
    relayoutTimer = null;
    layoutDocks();
    rearmMouse("the screens changed");
  }, 400);
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

/** after sleep: the window is back where it belongs and on top, drawn again, its space kept clear */
function wakeDocks(): void {
  for (const dock of [...docks.values()]) {
    if (dock.win.isDestroyed()) continue;
    if (dock.win.webContents.isCrashed()) {
      recreateDock(dock, "the dock page had crashed");
      continue;
    }
    dock.win.setBounds(geometry(dock.display));
    dock.win.setAlwaysOnTop(true, "pop-up-menu");
    if (!dock.fullscreen) {
      dock.win.showInactive();
      dock.win.moveTop();
    }
    dock.win.webContents.invalidate();
    dock.win.webContents.send("dock:info", dockInfo(dock.win));
    reserve(dock);
    void checkDrawing(dock);
  }
  rearmMouse("after the PC woke or the screen came back", true);
  applyTaskbar();
}

/** checked over twice: as soon as the PC is back, and again once Windows has settled its screens */
let wakeTimer: NodeJS.Timeout | null = null;
function wakeSoon(why: string): void {
  logEvery(`wake:${why}`, `${why}: checking the dock over`, 5000);
  if (wakeTimer) return;
  wakeTimer = setTimeout(() => {
    wakeDocks();
    wakeTimer = setTimeout(() => {
      wakeTimer = null;
      wakeDocks();
    }, 4500);
  }, 1500);
}

/** a line that could come often goes in the log at most once per `ms` */
const lastSaid = new Map<string, number>();
function logEvery(key: string, line: string, ms: number): void {
  const now = Date.now();
  if (now - (lastSaid.get(key) ?? 0) < ms) return;
  lastSaid.set(key, now);
  log(line);
}

/** a page whose drawing stopped (the graphics driver reset while the PC slept) is started afresh */
async function checkDrawing(dock: Dock): Promise<void> {
  if (dock.win.isDestroyed() || dock.fullscreen || !dock.win.isVisible()) return;
  const wc = dock.win.webContents;
  if (wc.isLoading() || Date.now() - dock.born < 5000) return;
  const drew = await Promise.race([
    wc.capturePage({ x: 0, y: 0, width: 1, height: 1 }).then(
      (img) => !img.isEmpty(),
      () => false,
    ),
    new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5000)),
  ]);
  if (!drew) recreateDock(dock, "the dock page wasn't drawing");
}

/** a new window for a dock that has gone wrong, in the same place; the old one goes once the new one shows */
function recreateDock(dock: Dock, why: string): void {
  if (quitting || docks.get(dock.display.id) !== dock) return;
  log(`${why}: the dock window was started afresh`);
  const old = dock.win;
  const fresh = createDock(dock.display);
  fresh.desktop = dock.desktop;
  fresh.fullscreen = dock.fullscreen;
  docks.set(dock.display.id, fresh);
  if (!old.isDestroyed()) {
    // meanwhile the old one lets every click through
    old.setIgnoreMouseEvents(true);
    const end = () => !old.isDestroyed() && old.destroy();
    fresh.win.once("ready-to-show", end);
    setTimeout(end, 3000);
  }
  // a new window joins whatever mouse hook is in, which may be the one that died
  rearmMouse("a new dock window", true);
}

// ---- the dock really getting the pointer ----
// Where a dock takes the mouse is decided here as well as in its page. While the dock is
// click-through, the page hears the pointer only through a low-level mouse hook that Electron
// keeps on VyseBar's main thread, and Windows drops such a hook without a word if that thread is
// ever slow to answer it (VyseBar held up for a moment, the PC waking from sleep). The page then
// hears nothing, never asks for the mouse, and the dock takes no clicks until VyseBar restarts.
// So main also watches the pointer itself against the dock's hit areas, and checks that the page
// hears the pointer moving over its window. When it doesn't, a new hook goes in; if that doesn't
// hold, the helper says what is under the pointer and the cause is dealt with: another app's
// window on top, a dock window gone wrong (started afresh), and last of all VyseBar restarting
// itself, which is what fixed it by hand.

/** in tests, a pretend pointer, so tests never move yours (never in an installed VyseBar) */
const testPointer = (): Electron.Point | undefined => (app.isPackaged ? undefined : (globalThis as { __vyseTestPointer?: Electron.Point }).__vyseTestPointer);
const cursorPoint = (): Electron.Point => testPointer() ?? screen.getCursorScreenPoint();

// Electron puts its mouse hook in when a window starts forwarding and no other was; every dock
// leaving click-through at once lets the old (maybe dead) hook go, and coming back puts in a new one
let rearmedAt = 0;
function rearmMouse(why: string, force = false): void {
  const now = Date.now();
  if (!force && now - rearmedAt < 2000) return;
  rearmedAt = now;
  const live = [...docks.values()].filter((d) => !d.win.isDestroyed());
  for (const d of live) d.win.setIgnoreMouseEvents(false);
  for (const d of live) applyMouse(d);
  logEvery(`rearm:${why}`, `a new mouse hook went in (${why})`, 10 * 60_000);
}

function watchPointer(): void {
  let lastCursor = { x: -1e9, y: -1e9 };
  let lastTick = Date.now();
  setInterval(() => {
    const now = Date.now();
    const gap = now - lastTick;
    lastTick = now;
    // sleep shows as a long pause whether or not Windows says so (Modern Standby often doesn't);
    // a shorter one is VyseBar held up long enough for Windows to drop the hook
    if (gap > 10_000) wakeSoon("VyseBar was paused for a while");
    else if (gap > 500) rearmMouse("after VyseBar was held up");
    const p = cursorPoint();
    const moved = p.x !== lastCursor.x || p.y !== lastCursor.y;
    if (moved) {
      lastCursor = p;
      glassActivity();
    }
    for (const dock of docks.values()) {
      if (dock.win.isDestroyed() || !dock.win.isVisible()) continue;
      const b = dock.win.getBounds();
      // an Explorer drag sends no mouse moves to a click-through window either: this is what
      // lets a file land on the plate
      const over = dock.hits.some((r) => p.x >= b.x + r.x && p.x <= b.x + r.x + r.width && p.y >= b.y + r.y - 4 && p.y <= b.y + r.y + r.height + 4);
      if (over !== dock.overHit) {
        dock.overHit = over;
        applyMouse(dock);
      }
      if (moved) listen(dock, p, b, now);
    }
  }, 60);
}

/** a pointer move over a dock's window, which its page should hear */
let repairing = false;
function listen(dock: Dock, p: Electron.Point, b: Electron.Rectangle, now: number): void {
  const wc = dock.win.webContents;
  // a few pixels in from the window's edges, where rounding can't put the pointer outside it
  const inside = p.x >= b.x + 4 && p.x < b.x + b.width - 4 && p.y >= b.y + 4 && p.y < b.y + b.height - 4;
  const taking = dock.wants || dock.overHit;
  // taking the mouse, the page hears only the pointer over its hit areas: elsewhere another
  // window may rightly be on top
  if (!inside || (taking && !dock.overHit) || repairing || wc.isLoading() || wc.isCrashed() || now - dock.born < 3000) {
    dock.deaf = null;
    return;
  }
  const r = noteMove(dock.deaf, now, dock.heardAt);
  dock.deaf = r.deaf;
  if (r.act) void repair(dock, taking, p);
}

/** the page answering a ping: one that doesn't is busy (or hung, which watchPages sees to) */
function pageAnswers(dock: Dock, ms = 1500): Promise<boolean> {
  const wc = dock.win.webContents;
  return new Promise((resolve) => {
    const done = (ok: boolean) => {
      clearTimeout(timer);
      ipcMain.removeListener("vyse:pong", heard);
      resolve(ok);
    };
    const heard = (e: Electron.IpcMainEvent) => e.sender === wc && done(true);
    const timer = setTimeout(() => done(false), ms);
    ipcMain.on("vyse:pong", heard);
    if (wc.isDestroyed()) done(false);
    else wc.send("vyse:ping");
  });
}

const ladders = new Map<number, Ladder>();
/** always-on-top windows the dock has given up pushing in front of, for now */
const coversSkipped = new Map<string, number>();
let lastClickThroughRecreate = 0;

async function repair(dock: Dock, taking: boolean, p: Electron.Point): Promise<void> {
  if (repairing) return;
  repairing = true;
  try {
    const id = dock.display.id;
    let ladder = ladders.get(id);
    if (!ladder) ladders.set(id, (ladder = new Ladder()));
    const step = ladder.next(Date.now());
    // a first try in click-through costs nothing; anything more asks the helper what is there
    let at: PointInfo | null = null;
    if (taking || step > 1) {
      const phys = screen.dipToScreenPoint(p);
      at = await host.try<PointInfo>("pointAt", { x: Math.round(phys.x), y: Math.round(phys.y) }, 1500);
    }
    if (dock.win.isDestroyed() || docks.get(id) !== dock) return;
    const now = Date.now();
    const verdict = at ? judgePoint(at, hwndOf(dock.win), (name) => (coversSkipped.get(name) ?? 0) > now) : null;
    let todo = chooseRepair(taking, verdict, step);
    // why nothing is done, for the log
    let held = todo !== "none" ? "" : verdict === "busy" ? "a mouse button was held or a menu was open" : verdict === "ours" ? "another VyseBar window is there" : verdict === "system" ? "a Windows menu or panel is there, or a window given up on" : "";
    if ((todo === "recreate" || todo === "relaunch") && !(await pageAnswers(dock))) {
      todo = "none";
      held = "its page didn't answer either, which the page watch sees to";
    }
    // touch moves the pointer without the mouse hook ever seeing it, so it looks like a deaf
    // click-through dock: no new window for that (a pretend test pointer is never touch), and
    // a click-through dock is started afresh at most every ten minutes anyway
    if (todo === "recreate" && !taking) {
      if (at?.touch && !testPointer()) {
        todo = "none";
        held = "touch or a pen may have moved the pointer";
      } else if (now - lastClickThroughRecreate < 10 * 60_000) todo = "stop";
      else lastClickThroughRecreate = now;
    }
    const under = !at ? "" : !at.hwnd ? "no window" : at.ours ? (verdict === "dock" ? "the dock" : "a VyseBar window") : `${coverName(at)}${at.topmost ? ", always on top" : ""}${at.alpha !== undefined ? `, opacity ${at.alpha}` : ""}`;
    const why = `the dock's page didn't hear the pointer (${taking ? "taking the mouse" : "click-through"}${under ? `; under the pointer: ${under}` : ""})`;
    if (held) logEvery(`held:${held}`, `${why}: left alone, as ${held}`, 10 * 60_000);
    carryOut(dock, todo, why, at, verdict);
  } finally {
    repairing = false;
  }
}

function carryOut(dock: Dock, todo: Repair, why: string, at: PointInfo | null, verdict: Verdict | null): void {
  const win = dock.win;
  if (win.isDestroyed()) return;
  switch (todo) {
    case "none":
      return;
    case "rearm":
      rearmMouse("its page had stopped hearing the pointer", true);
      return;
    case "raise":
    case "raiseHard":
      logEvery(`raise:${why}`, `${why}: the dock went back on top`, 60_000);
      if (todo === "raiseHard") win.setAlwaysOnTop(false);
      win.setAlwaysOnTop(true, "pop-up-menu");
      win.moveTop();
      return;
    case "reapply":
      log(`${why}: its window was put right`);
      win.setIgnoreMouseEvents(false);
      win.setAlwaysOnTop(true, "pop-up-menu");
      if (!dock.fullscreen) win.showInactive();
      win.moveTop();
      applyMouse(dock);
      return;
    case "recreate":
      recreateDock(dock, why);
      return;
    case "relaunch":
      relaunchVyseBar(why);
      return;
    case "stop":
      if (at && verdict === "covered") coversSkipped.set(coverName(at), Date.now() + 5 * 60_000);
      logEvery(`stop:${why}`, `${why}: nothing more to try for now`, 10 * 60_000);
  }
}

// VyseBar restarting itself, at most every ten minutes (a mark in userData says when it last did)
const relaunchMark = () => join(app.getPath("userData"), "pointer-restart.txt");
function relaunchVyseBar(why: string): void {
  let last = 0;
  try {
    last = Number(readFileSync(relaunchMark(), "utf8")) || 0;
  } catch {
    /* it never has */
  }
  if (Date.now() - last < 10 * 60_000) return logEvery("relaunch", `${why}: VyseBar restarted itself for this a few minutes ago, so not again yet`, 10 * 60_000);
  try {
    writeFileSync(relaunchMark(), String(Date.now()));
  } catch {
    /* it restarts all the same */
  }
  log(`${why}: VyseBar restarts itself`);
  app.relaunch({ args: [...process.argv.slice(1).filter((a) => a !== "--updated" && a !== "--recovered"), "--recovered"] });
  app.quit();
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
  if (host.ready) askGrabMode();
  watchPages();
  watchPointer();
  screen.on("display-added", (_e, d) => {
    log(`a screen was added (${d.size.width}x${d.size.height} at ${Math.round(d.scaleFactor * 100)}%)`);
    relayoutSoon();
  });
  screen.on("display-removed", () => {
    log("a screen was removed");
    relayoutSoon();
  });
  screen.on("display-metrics-changed", (_e, _d, changed) => {
    logEvery("metrics", `a screen changed (${changed.join(", ")})`, 60_000);
    relayoutSoon();
  });
  // tests reach the docks from the inspector (never in an installed VyseBar)
  if (!app.isPackaged) Object.assign(globalThis, { __vyseDocks: { docks, rearmMouse, recreateDock, wakeSoon, host } });

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
      else setTimeout(() => !dock.win.isDestroyed() && !dock.overHit && dock.win.webContents.send("dock:conceal"), 1200);
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

  // after the PC sleeps, the screen is locked or goes dark, the dock is checked over: put back
  // instead of leaving an empty strip, on top, drawing, and with a new mouse hook
  powerMonitor.on("suspend", () => logEvery("sleep", "the PC is going to sleep", 30_000));
  powerMonitor.on("resume", () => wakeSoon("the PC woke up"));
  powerMonitor.on("lock-screen", () => log("the screen was locked"));
  powerMonitor.on("unlock-screen", () => wakeSoon("the screen was unlocked"));
  // the helper hears the screen itself go off and on, which needs no sleep (Pointer.cs)
  let screenState: number | null = null;
  host.on("screenPower", (state: number) => {
    const was = screenState;
    screenState = state;
    if (was === null || was === state) return;
    if (state === 0) log("the screen turned off");
    else if (state === 1 && was === 0) wakeSoon("the screen came back on");
  });
  host.on("power", (what: string) => (what === "resume" ? wakeSoon("the PC woke up") : logEvery("sleep", "the PC is going to sleep", 30_000)));
  // a graphics process that went (a driver reset) can leave a dock that doesn't draw
  app.on("child-process-gone", (_e, d) => d.type === "GPU" && wakeSoon("the graphics process restarted"));

  host.on("hotkey", (k: { index: number; mode: string }) => {
    const dock = hotkeyDock();
    if (!dock || dock.win.isDestroyed()) return;
    markActive();
    // an auto-hidden dock comes up for a moment so you can see which app it was
    if (settings.value.autoHide) {
      dock.win.webContents.send("dock:reveal");
      setTimeout(() => !dock.win.isDestroyed() && !dock.overHit && dock.win.webContents.send("dock:conceal"), 1800);
    }
    dock.win.webContents.send("dock:hotkey", k);
  });

  host.on("ready", () => {
    applyTaskbar();
    for (const dock of docks.values()) reserve(dock);
    askGrabMode();
  });
  // a new helper reads with GDI until it's asked: keep the dock out of captures till then
  host.on("restarted", () => {
    setGrabSkipsDock(false);
    fullRect = null;
    applyFullscreen();
  });
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

  host.on("fullscreen", (rect: { x: number; y: number; width: number; height: number } | null) => {
    fullRect = rect ? screen.screenToDipRect(null, rect) : null;
    applyFullscreen();
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

  // where the page takes the mouse (see watchPointer)
  ipcMain.on("dock:hits", (e, rects: unknown) => {
    const dock = dockOf(e);
    if (!dock || !Array.isArray(rects)) return;
    dock.hits = rects
      .filter((r: Partial<Rect> | null): r is Rect => !!r && [r.x, r.y, r.width, r.height].every((v) => typeof v === "number" && Number.isFinite(v)))
      .slice(0, 64);
  });
  // the page heard the pointer: its mouse hook (or the pointer on it) works
  ipcMain.on("dock:heard", (e) => {
    const dock = dockOf(e);
    if (!dock) return;
    dock.heardAt = Date.now();
    dock.deaf = null;
  });

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
  ipcMain.handle("dock:wallpaperRegion", async (e) => {
    const dock = dockOf(e);
    const img = await wallpaperImage();
    if (!dock || !img || dock.win.isDestroyed()) return null;
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

  ipcMain.handle("dock:wallpaper", async () => {
    const img = await wallpaperImage();
    return img ? `data:image/jpeg;base64,${img.resize({ width: 1920 }).toJPEG(85).toString("base64")}` : null;
  });
}

// the wallpaper as Windows keeps it, read off the main thread and decoded once per change
let wallpaper: { key: string; img: Electron.NativeImage } | null = null;
async function wallpaperImage(): Promise<Electron.NativeImage | null> {
  const file = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Themes", "TranscodedWallpaper");
  try {
    const st = await stat(file);
    const key = `${st.size}:${st.mtimeMs}`;
    if (wallpaper?.key === key) return wallpaper.img;
    const img = nativeImage.createFromBuffer(await readFile(file));
    if (img.isEmpty()) return null;
    wallpaper = { key, img };
    return img;
  } catch {
    return null;
  }
}
