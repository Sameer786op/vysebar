// Updates from GitHub. A little after VyseBar starts, and every few hours after that, it looks for
// a newer release of github.com/Sameer786op/vysebar and downloads it in the background. A new
// version that is ready within the first minutes after VyseBar starts (the usual case: it was
// downloaded the day before and found again when the PC starts) is installed straight away;
// one that arrives later waits for "Restart now" on its toast, Settings › General, or the next
// start. Your settings and widgets live in %APPDATA%\VyseBar, which an update never touches.
import { app } from "electron";
import updater from "electron-updater";
import type { UpdateState } from "@shared/types";
import { broadcast } from "./broadcast";
import { host } from "./host";
import { flushAll } from "./store";
import { toast } from "./services/automations";

const { autoUpdater } = updater;

const FIRST_CHECK = 15_000;
const EVERY = 4 * 3600_000;
// an update ready this soon after VyseBar started goes in at once, before you're busy with it
const INSTALL_AT_START = 3 * 60_000;

let state: UpdateState = { status: "idle", version: app.getVersion() };
let installing = false;
const startedAt = Date.now();

function set(patch: Partial<UpdateState>): void {
  state = { ...state, ...patch };
  broadcast("update", state);
}

export const updateState = (): UpdateState => state;

export function initUpdates(): void {
  // a development build has no release to compare itself with
  if (!app.isPackaged) {
    state = { ...state, status: "off" };
    return;
  }
  // 32-bit builds pack an older Electron, so they read their own feed (ia32.yml)
  if (process.arch === "ia32") autoUpdater.channel = "ia32";
  autoUpdater.allowDowngrade = false; // setting the channel turns this on
  autoUpdater.allowPrerelease = false;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on("checking-for-update", () => set({ status: "checking", error: undefined }));
  autoUpdater.on("update-not-available", () => set({ status: "latest", checkedAt: Date.now() }));
  autoUpdater.on("update-available", (i) => set({ status: "downloading", next: i.version, percent: 0 }));
  autoUpdater.on("download-progress", (p) => set({ status: "downloading", percent: Math.round(p.percent) }));
  autoUpdater.on("update-downloaded", (i) => {
    set({ status: "ready", next: i.version, checkedAt: Date.now() });
    if (Date.now() - startedAt < INSTALL_AT_START) {
      toast({ id: "update", title: `Updating VyseBar to ${i.version}`, body: "Back in a few seconds", icon: "bell", tone: false });
      setTimeout(() => void installNow(), 2500);
      return;
    }
    toast({
      id: "update",
      title: `VyseBar ${i.version} is ready`,
      body: "Restart VyseBar to update, or it updates the next time your PC starts",
      icon: "bell",
      ttl: 30_000,
      action: { label: "Restart now", invoke: "update:install" },
    });
  });
  autoUpdater.on("error", (e: Error) => {
    if (installing) return;
    set({ status: "error", error: String(e?.message ?? e).split("\n")[0].slice(0, 160) });
  });

  setTimeout(check, FIRST_CHECK);
  setInterval(check, EVERY);
}

export function check(): void {
  if (!app.isPackaged || installing || state.status === "downloading" || state.status === "ready") return;
  // an error (offline, GitHub down) arrives through the "error" event
  autoUpdater.checkForUpdates().catch(() => undefined);
}

export async function installNow(): Promise<void> {
  if (state.status !== "ready" || installing) return;
  installing = true;
  flushAll();
  // the installer replaces the helper too, so it must be gone first (it puts the taskbar back)
  await host.stopAndWait(4000);
  autoUpdater.quitAndInstall(true, true);
  // the installer didn't start (its file vanished): come back as we were instead of sitting
  // there without the helper
  setTimeout(() => {
    app.relaunch();
    app.exit(0);
  }, 20_000).unref();
}
