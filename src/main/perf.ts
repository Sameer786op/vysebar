// Staying light on low-end PCs (lite mode: memory handed back to Windows while the dock sits
// idle), and staying quick everywhere else (Smooth: the dock's own processes keep their memory
// and their place for the CPU, however busy or short of memory the PC is).
import { app, BrowserWindow, webContents } from "electron";
import { freemem, release, totalmem } from "node:os";
import { setFlagsFromString } from "node:v8";
import { runInNewContext } from "node:vm";
import { host } from "./host";
import { log } from "./log";
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

let dockWindows: () => BrowserWindow[] = () => [];
const dockPids = (): Set<number> => new Set(dockWindows().filter((w) => !w.isDestroyed()).map((w) => w.webContents.getOSProcessId()));

async function trim(): Promise<void> {
  trimmedAt = Date.now();
  // Smooth hands back only what isn't the dock: the dock's page, the graphics process and the
  // helper stay as they are. On a PC short of memory what is handed back goes to disk, and the
  // next hover or click waited while Windows read it back (a second or more after a game).
  // VyseBar's own main process is never handed back: it watches the pointer for the dock
  const lite = isLite();
  const keep = lite ? new Set<number>() : dockPids();
  for (const wc of webContents.getAllWebContents()) if (!wc.isDestroyed() && !keep.has(wc.getOSProcessId())) wc.send("vyse:idle");
  gc?.();
  // give the renderers a moment to collect before their working sets go back
  await new Promise((r) => setTimeout(r, 1500));
  const pids = app.getAppMetrics().filter((m) => m.type !== "Browser" && !(!lite && (m.type === "GPU" || keep.has(m.pid))));
  await host.try("trim", { pids: pids.map((m) => m.pid), self: lite });
}

// ---- Smooth: the dock's processes stay in memory and ahead for the CPU (Resident.cs) ----
// how much of each Windows leaves in RAM however short it gets: about what each holds while
// the dock is in use
const KEEP_MB = { main: 128, page: 160, gpu: 160, helper: 96 };
let residentKey = "";
let residentAt = 0;
let residentLogged = false;

async function keepResident(): Promise<void> {
  const lite = isLite();
  const metrics = app.getAppMetrics();
  const pages = dockPids();
  const gpu = metrics.filter((m) => m.type === "GPU").map((m) => m.pid);
  const procs = lite
    ? [process.pid, ...pages].map((pid) => ({ pid, above: false }))
    : [
        { pid: process.pid, mb: KEEP_MB.main, above: true },
        ...[...pages].map((pid) => ({ pid, mb: KEEP_MB.page, above: true })),
        ...gpu.map((pid) => ({ pid, mb: KEEP_MB.gpu })),
      ];
  const key = `${lite}|${procs.map((p) => p.pid).join(",")}|${host.generation}`;
  // again when anything changed (a new dock page, a restarted helper), and every two minutes
  // anyway: Windows and Chromium may change a process's place for the CPU on their own
  if (key === residentKey && Date.now() - residentAt < 120_000) return;
  if (lite && !residentKey) return;
  const r = await host.try<Record<string, string>>("resident", lite ? { procs: [...procs, ...gpu.map((pid) => ({ pid }))], release: true } : { procs, self: KEEP_MB.helper });
  if (!r) return;
  residentKey = key;
  residentAt = Date.now();
  if (lite) {
    residentKey = "";
    return;
  }
  // once per start, and whenever something didn't take
  const failed = Object.values(r).some((v) => /not |no access|unchanged/.test(v));
  if (!residentLogged || failed) {
    residentLogged = true;
    const name = (pid: string) => (pid === "helper" ? "helper" : Number(pid) === process.pid ? "main" : pages.has(Number(pid)) ? "dock page" : gpu.includes(Number(pid)) ? "graphics" : pid);
    log(`kept quick: ${Object.entries(r).map(([pid, v]) => `${name(pid)} ${v}`).join("; ")}`);
  }
}

export function initMemoryTrim(docks: () => BrowserWindow[]): void {
  dockWindows = docks;
  setTimeout(() => void keepResident(), 3000);
  setInterval(() => void keepResident(), 15_000);
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

/** a fullscreen game or video covers the dock: give back what isn't the dock at once (in lite
 * mode, everything) */
export function trimNow(): void {
  void trim();
}

const gb = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

/** " (PC memory free: 0.9 of 15.6 GB)", for log lines about the dock being held up */
export function memoryNote(): string {
  return ` (PC memory free: ${gb(freemem())} of ${gb(totalmem())} GB)`;
}

/** how much memory the PC has free, and how much of each of VyseBar's processes is in RAM
 * (of what it holds), for the log's snapshot of a dock that seems stuck */
export async function memorySnapshot(): Promise<string> {
  const pages = dockPids();
  const mb = (kb: number) => Math.round(kb / 1024);
  const parts = app
    .getAppMetrics()
    .filter((m) => m.type === "Browser" || m.type === "GPU" || pages.has(m.pid))
    .map((m) => `${m.type === "Browser" ? "main" : m.type === "GPU" ? "graphics" : "page"} ${mb(m.memory.workingSetSize)} of ${mb(m.memory.privateBytes ?? m.memory.workingSetSize)} MB`);
  const h = await host.try<{ ram: number; private: number }>("mem", {}, 1000);
  if (h) parts.push(`helper ${h.ram} of ${h.private} MB`);
  return `PC ${gb(freemem())} of ${gb(totalmem())} GB free, in RAM ${parts.join(", ")}`;
}

/** a new dock page or graphics process: keep it quick from the start */
export function keepResidentSoon(): void {
  residentAt = 0;
  setTimeout(() => void keepResident(), 1500);
}
