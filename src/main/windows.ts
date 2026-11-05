// Settings and the widget picker: ordinary windows with Windows 11's Mica behind them.
import { BrowserWindow, screen } from "electron";
import { bringToFront, loadPage, preloadPath } from "./docks";
import { broadcast } from "./broadcast";
import { win11 } from "./perf";

const open = new Map<string, BrowserWindow>();

function panel(route: string, width: number, height: number): BrowserWindow {
  const key = route.split("?")[0];
  const existing = open.get(key);
  if (existing && !existing.isDestroyed()) {
    existing.webContents.send("route", route);
    if (existing.isMinimized()) existing.restore();
    bringToFront(existing);
    return existing;
  }
  const area = screen.getPrimaryDisplay().workArea;
  const win = new BrowserWindow({
    width,
    height,
    x: Math.round(area.x + (area.width - width) / 2),
    y: Math.round(area.y + (area.height - height) / 2),
    minWidth: 720,
    minHeight: 480,
    show: false,
    title: key === "settings" ? "VyseBar Settings" : "Widgets",
    // Windows 10 has no Mica, so its panels get a solid background instead of a see-through one
    backgroundColor: win11 ? "#00000000" : "#202024",
    ...(win11 ? { backgroundMaterial: "mica" as const } : {}),
    titleBarStyle: "hidden",
    titleBarOverlay: { color: "#00000000", symbolColor: "#e5e5ea", height: 44 },
    autoHideMenuBar: true,
    webPreferences: { preload: preloadPath(), sandbox: true, spellcheck: false },
  });
  loadPage(win, route);
  win.once("ready-to-show", () => bringToFront(win));
  win.on("closed", () => open.delete(key));
  open.set(key, win);
  return win;
}

export function openSettings(page = "appearance"): void {
  panel(`settings?page=${page}`, 900, 640);
}

export function openWidgets(): void {
  const fresh = !open.has("widgets");
  const win = panel("widgets", 1040, 700);
  // while the picker is open the dock shows remove badges on every widget
  if (fresh) {
    broadcast("picker", true);
    win.on("closed", () => broadcast("picker", false));
  }
}
