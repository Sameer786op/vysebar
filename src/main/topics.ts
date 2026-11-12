// Live data feeds ("topics") run only while some widget on screen shows them: a dock with
// no weather tile makes no weather requests.
import { app, ipcMain, net, powerMonitor, webContents } from "electron";
import { log } from "./log";
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
  /** what was last sent, to leave out sending the same again */
  lastJson: string | undefined;
  running: boolean;
}

const topics = new Map<string, Topic>();

export function defineTopic(name: string, source: TopicSource): void {
  topics.set(name, { source, subscribers: new Set(), last: undefined, lastJson: undefined, running: false });
  (source as Partial<Poller>).named?.(name);
}

export function publish(name: string, data: unknown): void {
  const t = topics.get(name);
  if (!t) return;
  // the same as last time (a volume or a switch that didn't change): nothing to send, and
  // nothing for the dock to draw again
  let json: string | undefined;
  try {
    json = JSON.stringify(data);
  } catch {
    json = undefined;
  }
  if (json !== undefined && json === t.lastJson && t.last !== undefined) return;
  t.lastJson = json;
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
  watchFeeds();
}

// ---------- polled feeds ----------

// after a failed poll (the network not back yet after sleep, a server's bad minute) a feed asks
// again soon, then less and less often, and never later than its usual time
const RETRY = [10_000, 30_000, 60_000, 2 * 60_000, 5 * 60_000, 10 * 60_000];

interface Poller extends TopicSource {
  named(name: string): void;
  info: PollerInfo;
}

interface PollerInfo {
  name: string;
  ms: number;
  running: boolean;
  busy: boolean;
  /** when the last poll began, its answer came, and how long until the next */
  lastTry: number;
  lastOk: number;
  wait: number;
  failures: number;
  /** a poll now, in place of the one waiting */
  kick(): void;
}

const pollers = new Set<PollerInfo>();
// for tests on a development copy: the next n polls of a feed fail
const failNext = new Map<string, number>();

/** a passing failure (no connection yet after sleep, a timeout, a server's bad minute): the feed
 * keeps showing what it had and asks again soon. `show` is shown only when it has nothing yet */
export function passing(message: string, show: unknown): Error {
  return Object.assign(new Error(message), { show });
}

/** an answer that won't change by asking again (a refused key, a wrong setting): for the widget
 * to show, unlike a passing failure. Status lines start with the code ("404 Not Found") */
export const isRefusal = (message: string): boolean => /^4\d\d\b/.test(message) && !/^4(08|25|29)\b/.test(message);

/** an error's first words for the log, without links or keys */
function clean(e: unknown): string {
  const m = (e as Error)?.message ?? String(e);
  return m
    .replace(/\b(https?|file):\S+/g, "<link>")
    .replace(/(token|key|secret|password)=\S+/gi, "$1=…")
    .slice(0, 120);
}

/** a topic that polls fn every ms while it has subscribers */
export function poller(fn: () => Promise<unknown> | unknown, ms: number): TopicSource {
  let timer: NodeJS.Timeout | null = null;
  let pub: ((d: unknown) => void) | null = null;
  // each start begins a new run: a poll still on its way from an earlier run ends that run
  // instead of carrying on beside the new one (which would poll twice as often from then on)
  let run = 0;
  // goes up with every poll begun, and when one is given up on: only the newest one's answer counts
  let seq = 0;
  // a refresh asked for while a poll was on its way: another poll follows straight after it
  let again = false;
  let loggedAt = 0;
  let logged = false;
  // polls on their way (an earlier run's may still be out when a new run begins)
  let inFlight = 0;
  const info: PollerInfo = { name: "feed", ms, running: false, busy: false, lastTry: 0, lastOk: 0, wait: ms, failures: 0, kick: () => kick() };
  // in lite mode the fast topics (stats, volume, network) poll half as often
  const every = () => (ms < 10_000 && isLite() ? ms * 2 : ms);

  const tick = async (r: number): Promise<boolean> => {
    const mine = ++seq;
    info.lastTry = Date.now();
    try {
      const n = failNext.get(info.name) ?? 0;
      if (n > 0) {
        failNext.set(info.name, n - 1);
        throw new Error("a test failure");
      }
      const v = await fn();
      // given up on, a newer run, or asked again meanwhile (a setting changed): the next answer is the one to show
      if (mine !== seq || r !== run || again) return true;
      if (v !== undefined) pub?.(v);
      info.lastOk = Date.now();
      if (logged) log(`${info.name} is updating again`);
      logged = false;
      info.failures = 0;
      return true;
    } catch (e) {
      if (mine !== seq || r !== run) return true;
      info.failures++;
      // nothing to show yet: the reason, while it asks again
      const show = (e as { show?: unknown } | null)?.show;
      if (show !== undefined && !info.lastOk) pub?.(show);
      // a line an hour at most per feed; offline for a day is one line, not hundreds
      if (Date.now() - loggedAt > 3600_000) {
        loggedAt = Date.now();
        logged = true;
        log(`${info.name} couldn't update (${clean(e)}): trying again in ${Math.round(delayAfter(false) / 1000)} s`);
      }
      return false;
    }
  };

  // a poll that never settles mustn't stop the feed for good: after a while it is given up on
  // (its answer, should it still come, is left out) and counts as a failure
  const limit = Math.min(Math.max(2 * ms, 60_000), 5 * 60_000);
  const settled = async (r: number): Promise<boolean> => {
    let t: NodeJS.Timeout | undefined;
    const late = new Promise<"late">((res) => (t = setTimeout(() => res("late"), limit)));
    const out = await Promise.race([tick(r), late]).finally(() => clearTimeout(t));
    if (out !== "late") return out;
    seq++;
    info.failures++;
    return false;
  };

  const delayAfter = (ok: boolean) => (ok ? every() : Math.min(every(), RETRY[Math.min(info.failures, RETRY.length) - 1] ?? every()));

  const cycle = async (r: number): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    if (r !== run || !pub) return;
    inFlight++;
    info.busy = true;
    let ok = false;
    try {
      do {
        again = false;
        ok = await settled(r);
      } while (again && r === run && pub);
    } finally {
      info.busy = --inFlight > 0;
    }
    if (r !== run || !pub) return;
    info.wait = delayAfter(ok);
    timer = setTimeout(() => void cycle(r), info.wait);
  };

  const kick = () => {
    if (!pub) return;
    if (info.busy) again = true;
    else void cycle(run);
  };

  const source: Poller = {
    info,
    named(name) {
      info.name = name;
    },
    start(publishFn) {
      pub = publishFn;
      info.running = true;
      pollers.add(info);
      void cycle(++run);
    },
    stop() {
      run++;
      if (timer) clearTimeout(timer);
      timer = null;
      pub = null;
      info.running = false;
      pollers.delete(info);
    },
    refresh: kick,
  };
  return source;
}

// The PC waking up, unlocking or getting its connection back: feeds that are behind ask at once
// (and keep asking while the network comes back). And a feed whose timer didn't fire on time
// (a long sleep) is polled now rather than whenever the timer gets round to it.
let feedsWatched = false;
function watchFeeds(): void {
  if (feedsWatched) return;
  feedsWatched = true;
  const slow = (p: PollerInfo) => p.ms >= 60_000;
  const behind = (p: PollerInfo, olderThan: number) => p.running && !p.busy && slow(p) && Date.now() - p.lastOk > olderThan;
  const catchUp = (olderThan: number) => {
    for (const p of [...pollers]) if (behind(p, olderThan)) p.kick();
  };
  const woke = () => setTimeout(() => catchUp(60_000), 4000);
  powerMonitor.on("resume", woke);
  powerMonitor.on("unlock-screen", woke);
  let online = net.isOnline();
  setInterval(() => {
    const now = Date.now();
    for (const p of [...pollers]) if (p.running && !p.busy && p.lastTry && now - p.lastTry > p.wait + 60_000) p.kick();
    const on = net.isOnline();
    // back online: every feed that failed, or is older than its usual time, now
    if (on && !online) for (const p of [...pollers]) if (p.running && !p.busy && slow(p) && (p.failures > 0 || now - p.lastOk > p.wait)) p.kick();
    online = on;
  }, 15_000);
  if (!app.isPackaged)
    Object.assign(globalThis, {
      __vyseTopics: {
        topics,
        pollers: () => [...pollers].map(({ kick: _k, ...p }) => p),
        failNext: (name: string, n: number) => failNext.set(name, n),
        kick: (name: string) => [...pollers].find((p) => p.name === name)?.kick(),
        keepAlive,
      },
    });
}
