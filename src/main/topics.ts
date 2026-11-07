// Live data feeds ("topics") run only while some widget on screen shows them: a dock with
// no weather tile makes no weather requests.
import { ipcMain, webContents } from "electron";
import { isLite } from "./perf";

export interface TopicSource {
  start(publish: (data: unknown) => void): void;
  stop?(): void;
  /** called on demand, e.g. after the widget changed something */
  refresh?(): void;
}

interface Topic {
  source: TopicSource;
  subscribers: Set<number>;
  last: unknown;
  running: boolean;
}

const topics = new Map<string, Topic>();

export function defineTopic(name: string, source: TopicSource): void {
  topics.set(name, { source, subscribers: new Set(), last: undefined, running: false });
}

export function publish(name: string, data: unknown): void {
  const t = topics.get(name);
  if (!t) return;
  t.last = data;
  for (const id of t.subscribers) {
    const wc = webContents.fromId(id);
    if (wc && !wc.isDestroyed()) wc.send("topic", name, data);
  }
}

export function lastValue<T>(name: string): T | undefined {
  return topics.get(name)?.last as T | undefined;
}

export function refreshTopic(name: string): void {
  const t = topics.get(name);
  if (t?.running) t.source.refresh?.();
}

const pinned = new Set<string>();

/**
 * keeps a topic running even with no window subscribed (automations read it), also after the
 * last card or tile that showed it has gone
 */
export function keepAlive(name: string): void {
  pinned.add(name);
  const t = topics.get(name);
  if (!t || t.running) return;
  t.running = true;
  t.source.start((d) => publish(name, d));
}

function unsubscribe(name: string, id: number): void {
  const t = topics.get(name);
  if (!t) return;
  t.subscribers.delete(id);
  if (t.subscribers.size === 0 && t.running && !pinned.has(name)) {
    t.running = false;
    t.source.stop?.();
  }
}

// one listener per window drops all of its subscriptions when it closes
const watched = new Set<number>();

export function registerTopicIpc(): void {
  ipcMain.handle("topic:sub", (e, name: string) => {
    const t = topics.get(name);
    if (!t) return undefined;
    const id = e.sender.id;
    t.subscribers.add(id);
    if (!watched.has(id)) {
      watched.add(id);
      e.sender.once("destroyed", () => {
        watched.delete(id);
        for (const n of topics.keys()) unsubscribe(n, id);
      });
    }
    if (!t.running) {
      t.running = true;
      t.source.start((d) => publish(name, d));
    }
    return t.last;
  });
  ipcMain.on("topic:unsub", (e, name: string) => unsubscribe(name, e.sender.id));
  ipcMain.on("topic:refresh", (_e, name: string) => refreshTopic(name));
}

/** a topic that polls fn every ms while it has subscribers */
export function poller(fn: () => Promise<unknown> | unknown, ms: number): TopicSource {
  let timer: NodeJS.Timeout | null = null;
  let pub: ((d: unknown) => void) | null = null;
  // each start begins a new run: a poll still on its way from an earlier run ends that run
  // instead of carrying on beside the new one (which would poll twice as often from then on)
  let run = 0;
  const tick = async () => {
    try {
      const v = await fn();
      if (v !== undefined) pub?.(v);
    } catch (e) {
      console.error("topic poll failed:", (e as Error).message);
    }
  };
  // a poll that never settles mustn't stop the feed for good: after a while the next one goes ahead
  const settled = (p: Promise<void>) => {
    let t: NodeJS.Timeout | undefined;
    const late = new Promise<void>((r) => (t = setTimeout(r, Math.max(2 * ms, 120_000))));
    return Promise.race([p, late]).finally(() => clearTimeout(t));
  };
  // in lite mode the fast topics (stats, volume, network) poll half as often
  const next = (r: number) => {
    timer = setTimeout(async () => {
      await settled(tick());
      if (pub && r === run) next(r);
    }, ms < 10_000 && isLite() ? ms * 2 : ms);
  };
  return {
    start(publishFn) {
      pub = publishFn;
      const r = ++run;
      void tick();
      next(r);
    },
    stop() {
      run++;
      if (timer) clearTimeout(timer);
      timer = null;
      pub = null;
    },
    refresh() {
      void tick();
    },
  };
}
