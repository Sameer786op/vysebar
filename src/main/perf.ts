// Staying light on low-end PCs: lite mode, and memory handed back to Windows while the dock
// sits idle (its pages fault back in, unnoticed, the next time they're touched).
import { app, BrowserWindow, webContents } from "electron";
import { release, totalmem } from "node:os";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { host } from "./host";
import { settings } from "./store";

/** 32-bit Windows, or 4 GB of RAM or less */
export const lowEnd = process.arch === "ia32" || totalmem() <= 4.5 * 1024 ** 3;
export const isLite = (): boolean => settings.value.performance === "lite" || (settings.value.performance === "auto" && lowEnd);
/** Windows 11 (build 22000+) has Mica and rounded corners; Windows 10 gets solid panels */
export const win11 = Number(release().split(".")[2] ?? 0) >= 22000;

/** Chromium and V8 switches; they must be set before the app is ready */
export function applyEngineFlags(): void {
  const lite = isLite();
  // a smaller young generation keeps each renderer's heap tight; the dock allocates little
  app.commandLine.appendSwitch("js-flags", `--expose-gc --max-semi-space-size=${lite ? 1 : 4}${lite ? " --optimize-for-size" : ""}`);
  // no spare renderer kept warm, and media keys stay with Windows rather than Chromium
  app.commandLine.appendSwitch("disable-features", "SpareRendererForSitePerProcess,HardwareMediaKeyHandling,MediaSessionService");
  if (lite) app.commandLine.appendSwitch("enable-features", "NetworkServiceInProcess2");
}

let lastActive = Date.now();
let trimmedAt = 0;
/** called on anything that means the dock is in use */
export function markActive(): void {
  lastActive = Date.now();
}

setFlagsFromString("--expose-gc");
const gc = runInNewContext("gc") as (() => void) | undefined;

async function trim(everything = false): Promise<void> {
  trimmedAt = Date.now();
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed()) wc.send("vyse:idle");
  gc?.();
  // give the renderers a moment to collect before their working sets go back
  await new Promise((r) => setTimeout(r, 1500));
  // Smooth keeps the GPU process warm: paging its textures and driver state back in is what
  // makes the first hover after a quiet spell stutter. VyseBar's own main process is never
  // trimmed: it watches the pointer for the dock, and paging it back in held that up
  const keepGpu = !everything && !isLite();
  await host.try("trim", { pids: app.getAppMetrics().filter((m) => m.type !== "Browser" && !(keepGpu && m.type === "GPU")).map((m) => m.pid) });
}

export function initMemoryTrim(docks: () => BrowserWindow[]): void {
  setInterval(() => {
    const now = Date.now();
    const idle = isLite() ? 15_000 : 120_000;
    const every = isLite() ? 45_000 : 300_000;
    if (now - lastActive < idle || now - trimmedAt < every) return;
    // Settings or the picker being open means someone is using VyseBar
    const dockSet = new Set(docks());
    if (BrowserWindow.getAllWindows().some((w) => !dockSet.has(w) && w.isVisible())) return;
    void trim();
  }, 5_000);
}

/** a fullscreen game or video covers the dock: give everything back at once */
export function trimNow(): void {
  void trim(true);
}
