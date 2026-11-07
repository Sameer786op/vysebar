// CPU, memory, network speed, drives, volume, radios and the other system feeds.
import { statfs } from "node:fs/promises";
import { cpus, freemem, totalmem } from "node:os";
import { host } from "../host";
import { defineTopic, poller, publish } from "../topics";
import { getIcon, iconSource, resolveAumidPath } from "../apps";
import type { MediaState } from "@shared/types";

let lastCpu = cpus();
function cpuPercent(): number {
  const now = cpus();
  let idle = 0;
  let total = 0;
  now.forEach((c, i) => {
    const p = lastCpu[i]?.times ?? c.times;
    const t = c.times;
    idle += t.idle - p.idle;
    total += t.user + t.nice + t.sys + t.irq + t.idle - (p.user + p.nice + p.sys + p.irq + p.idle);
  });
  lastCpu = now;
  return total > 0 ? Math.round(100 * (1 - idle / total)) : 0;
}

const cpuHistory: number[] = [];
const netHistory: { rx: number; tx: number }[] = [];
let lastNet: { rx: number; tx: number; at: number } | null = null;

// a drive that takes a long time to answer (a mapped network drive whose server is gone, a disc
// spinning up) is left out for a few minutes instead of being asked again and again
const slowDrives = new Map<string, number>();
// a question still out isn't asked again: each one holds one of the few threads Node does all
// file work on, and enough of them stuck would hold up every file VyseBar reads
const asking = new Set<string>();

/** each drive's size and free space, asked of Windows off the main thread */
export async function drives(): Promise<{ letter: string; total: number; free: number }[]> {
  const now = Date.now();
  const letters = [..."CDEFGHIJKLMNOPQRSTUVWXYZ"].filter((L) => (slowDrives.get(L) ?? 0) <= now && !asking.has(L));
  const found = await Promise.all(
    letters.map(async (L) => {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<"late">((r) => (timer = setTimeout(() => r("late"), 3000)));
      asking.add(L);
      const ask = statfs(`${L}:\\`).finally(() => asking.delete(L));
      try {
        const s = await Promise.race([ask, late]);
        if (s === "late") {
          slowDrives.set(L, Date.now() + 5 * 60_000);
          return null;
        }
        const total = s.blocks * s.bsize;
        return total > 0 ? { letter: L, total, free: s.bavail * s.bsize } : null;
      } catch {
        return null; // no such drive, or not ready (an empty card reader)
      } finally {
        clearTimeout(timer);
      }
    }),
  );
  return found.filter((d): d is { letter: string; total: number; free: number } => !!d);
}

export function initSystemTopics(): void {
  defineTopic(
    "system",
    poller(() => {
      const cpu = cpuPercent();
      cpuHistory.push(cpu);
      if (cpuHistory.length > 60) cpuHistory.shift();
      const total = totalmem();
      const used = total - freemem();
      return { cpu, ram: Math.round((used / total) * 100), ramUsed: used, ramTotal: total, cpuHistory: [...cpuHistory], cores: cpus().length, model: cpus()[0]?.model };
    }, 2000),
  );

  defineTopic(
    "network",
    poller(async () => {
      const n = await host.try<{ rx: number; tx: number; connected: boolean; kind: string | null }>("network");
      if (!n) return undefined;
      const now = Date.now();
      let down = 0;
      let up = 0;
      if (lastNet) {
        const dt = (now - lastNet.at) / 1000;
        down = Math.max(0, (n.rx - lastNet.rx) / dt);
        up = Math.max(0, (n.tx - lastNet.tx) / dt);
      }
      lastNet = { rx: n.rx, tx: n.tx, at: now };
      netHistory.push({ rx: down, tx: up });
      if (netHistory.length > 60) netHistory.shift();
      return { down, up, connected: n.connected, kind: n.kind, history: [...netHistory] };
    }, 1000),
  );

  defineTopic("storage", poller(async () => ({ drives: await drives() }), 60_000));
  defineTopic("volume", poller(() => host.try("volume"), 1500));
  defineTopic("radios", poller(() => host.try("radios"), 5000));
  defineTopic("mic", poller(() => host.try("micState"), 2000));
  // paired Bluetooth devices and their batteries change slowly; Windows itself reads them every few minutes
  defineTopic("bluetooth", poller(() => host.try("bluetooth", {}, 20_000), 30_000));
  defineTopic("theme", poller(() => host.try("theme"), 5000));
  defineTopic("brightness", poller(() => host.try("brightness"), 4000));
  defineTopic("keyboard", poller(() => host.try("keyboard"), 1500));
  defineTopic("recycle", poller(() => host.try("recycleBin"), 10_000));

  // Now Playing arrives as events; the source app's icon and name come along
  let media: MediaState | null = null;
  const appInfo = new Map<string, { name: string; icon?: string }>();
  // the first time an app plays, its icon takes a moment; a newer event that came meanwhile wins
  let mediaSeq = 0;
  const pushMedia = async (m: MediaState | null) => {
    const seq = ++mediaSeq;
    if (m && m.app) {
      let info = appInfo.get(m.app);
      if (!info) {
        const path = resolveAumidPath(m.app);
        const exeLike = /\.exe$/i.test(m.app);
        const name = (exeLike ? m.app.replace(/\.exe$/i, "") : m.app.split("!")[0].split("_")[0].split(".").pop()) ?? m.app;
        info = { name, icon: await getIcon(path ? [path] : exeLike ? [] : iconSource({ aumid: m.app }), 32) };
        appInfo.set(m.app, info);
      }
      m = { ...m, appName: info.name, appIcon: info.icon };
    }
    if (seq !== mediaSeq) return;
    media = m;
    publish("media", media);
  };
  defineTopic("media", {
    start() {
      void host.try<MediaState | null>("mediaStart").then((m) => pushMedia(m));
    },
    refresh() {
      void host.try<MediaState | null>("media").then((m) => pushMedia(m));
    },
  });
  host.on("media", (m: MediaState | null) => void pushMedia(m));
  host.on("ready", () => void host.try("mediaStart"));

  // the notification area: VyseHost stands in as the tray only while a tray widget is showing.
  // Starts and stops run one after another so a quick stop-start can't finish out of order, and
  // a stop waits a little: each start asks every app to re-add its tray icon
  let trayOn = false;
  let trayStopTimer: NodeJS.Timeout | undefined;
  let trayQueue: Promise<unknown> = Promise.resolve();
  const traySync = () => {
    trayQueue = trayQueue.then(async () => {
      if (!trayOn) return host.try("trayStop");
      const l = await host.try<unknown[]>("trayStart");
      if (l && trayOn) publish("tray", l);
    });
  };
  defineTopic("tray", {
    start() {
      clearTimeout(trayStopTimer);
      trayOn = true;
      traySync();
    },
    stop() {
      clearTimeout(trayStopTimer);
      trayStopTimer = setTimeout(() => {
        trayOn = false;
        traySync();
      }, 5000);
    },
  });
  host.on("tray", (l: unknown[]) => trayOn && publish("tray", l));
  host.on("ready", () => trayOn && traySync());
}

export async function mediaNow(): Promise<MediaState | null> {
  return host.try<MediaState | null>("media");
}
