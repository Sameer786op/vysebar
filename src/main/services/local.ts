// Feeds read from this PC only: Claude Code usage, screen time, downloads and screenshots.
import { existsSync, readFileSync } from "node:fs";
import { access, open, readdir, stat, type FileHandle } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, extname, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { app, nativeImage, powerMonitor, shell } from "electron";
import { host } from "../host";
import { getIcon } from "../apps";
import { settings } from "../store";
import { defineTopic, poller } from "../topics";
import { writeFileAtomic } from "../files";

// ---------- Claude Code: tokens from its local history, in 5-hour session windows ----------

interface Usage {
  t: number;
  tokens: number;
  input: number;
  output: number;
  model: string;
}

const claudeDir = join(homedir(), ".claude", "projects");
const offsets = new Map<string, { size: number; offset: number; rest: string }>();
const seen = new Set<string>();
let usage: Usage[] = [];

// History files grow to hundreds of megabytes. They are read a megabyte at a time, off the main
// thread, so the dock (and the pointer, which waits on VyseBar's main thread while it is over
// the dock) carries on between pieces instead of stopping until the whole read is done.
const CHUNK = 1024 * 1024;
// how far apart the first look at a big file probes for where the last eight days begin
const STEP = 4 * 1024 * 1024;

/** calls onLine for each complete line in [start, end); returns the unfinished last line */
async function readLines(fh: FileHandle, start: number, end: number, carry: string, onLine: (line: string) => void): Promise<string> {
  const buf = Buffer.alloc(Math.max(1, Math.min(CHUNK, end - start)));
  const dec = new StringDecoder("utf8");
  let rest = carry;
  for (let pos = start; pos < end; ) {
    const { bytesRead: n } = await fh.read(buf, 0, Math.min(buf.length, end - pos), pos);
    if (n <= 0) break;
    pos += n;
    const lines = (rest + dec.write(buf.subarray(0, n))).split("\n");
    rest = lines.pop() ?? "";
    for (const line of lines) onLine(line);
  }
  return rest;
}

/** the first timestamp logged at or after pos, or null */
async function timestampNear(fh: FileHandle, pos: number): Promise<number | null> {
  const buf = Buffer.alloc(256 * 1024);
  const { bytesRead: n } = await fh.read(buf, 0, buf.length, pos);
  const m = /"timestamp":"([^"]+)"/.exec(buf.toString("utf8", 0, n));
  return m ? Date.parse(m[1]) : null;
}

/** where a file's last `since` ms begin: steps back from the end a few megabytes at a time */
async function startOfRecent(fh: FileHandle, size: number, since: number): Promise<number> {
  for (let pos = size - STEP; pos > 0; pos -= STEP) {
    const t = await timestampNear(fh, pos);
    if (t !== null && t < since) return pos;
  }
  return 0;
}

// a refresh that comes while a scan is under way waits for it rather than reading beside it
let scanning: Promise<void> | null = null;
function scanClaude(): Promise<void> {
  scanning ??= readClaude().finally(() => (scanning = null));
  return scanning;
}

async function readClaude(): Promise<void> {
  if (!existsSync(claudeDir)) return;
  const cutoff = Date.now() - 8 * 86400_000;
  const onLine = (line: string) => {
    if (!line.includes('"usage"')) return;
    try {
      const e = JSON.parse(line);
      const m = e.message;
      if (e.type !== "assistant" || !m?.usage) return;
      // one reply is logged once per content block; count it once
      const id = `${m.id}:${e.requestId ?? ""}`;
      if (seen.has(id)) return;
      seen.add(id);
      const u = m.usage;
      const t = new Date(e.timestamp).getTime();
      if (t < cutoff) return;
      usage.push({
        t,
        input: u.input_tokens ?? 0,
        output: u.output_tokens ?? 0,
        tokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
        model: m.model ?? "unknown",
      });
    } catch {
      /* a partial line */
    }
  };
  for (const project of await readdir(claudeDir).catch(() => [] as string[])) {
    const dir = join(claudeDir, project);
    let files: string[];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      const file = join(dir, f);
      let st;
      try {
        st = await stat(file);
      } catch {
        continue;
      }
      if (st.mtimeMs < cutoff) continue;
      const prev = offsets.get(file);
      if (prev && st.size === prev.size) continue;
      let fh: FileHandle;
      try {
        fh = await open(file, "r");
      } catch {
        continue;
      }
      try {
        // a file that shrank was rewritten: read it again from the top
        const resume = prev && st.size >= prev.offset ? prev : null;
        let start = resume ? resume.offset : 0;
        // first look at a big file: jump to where the last eight days begin, which lands mid-line
        let skipPartial = false;
        if (!resume && st.size > STEP) {
          start = await startOfRecent(fh, st.size, cutoff);
          skipPartial = start > 0;
        }
        const rest = await readLines(fh, start, st.size, resume?.rest ?? "", (line) => {
          if (skipPartial) {
            skipPartial = false;
            return;
          }
          onLine(line);
        });
        offsets.set(file, { size: st.size, offset: st.size, rest });
      } catch {
        /* the file went away or was locked mid-read: the next look tries again */
      } finally {
        await fh.close().catch(() => undefined);
      }
    }
  }
  usage = usage.filter((u) => u.t >= cutoff).sort((a, b) => a.t - b.t);
}

async function claudeSummary() {
  await scanClaude();
  if (!existsSync(claudeDir)) return { error: "Claude Code isn't on this PC" };
  const H5 = 5 * 3600_000;
  // session windows as Claude counts them: 5 hours from the first message's hour
  let blockStart = 0;
  let last = 0;
  for (const u of usage) {
    if (!blockStart || u.t >= blockStart + H5 || u.t - last >= H5) {
      const d = new Date(u.t);
      d.setMinutes(0, 0, 0);
      blockStart = d.getTime();
    }
    last = u.t;
  }
  const now = Date.now();
  const active = blockStart && now < blockStart + H5;
  const session = active ? usage.filter((u) => u.t >= blockStart) : [];
  const sessionTokens = session.reduce((s, u) => s + u.tokens, 0);
  const week = usage.filter((u) => u.t >= now - 7 * 86400_000);
  const weekTokens = week.reduce((s, u) => s + u.tokens, 0);
  const models = new Map<string, number>();
  for (const u of week) models.set(u.model, (models.get(u.model) ?? 0) + u.tokens);
  const top = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  // the session's tokens through its window, in 20 slices, for the card's chart
  const series: number[] = [];
  if (active) {
    let acc = 0;
    for (let i = 1; i <= 20; i++) {
      const until = blockStart + (H5 * i) / 20;
      if (until > now + H5 / 20) break;
      acc = session.filter((u) => u.t < until).reduce((s, u) => s + u.tokens, 0);
      series.push(acc);
    }
  }
  const daily: { date: string; tokens: number }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now - i * 86400_000);
    const key = d.toISOString().slice(0, 10);
    daily.push({ date: key, tokens: week.filter((u) => new Date(u.t).toISOString().slice(0, 10) === key).reduce((s, u) => s + u.tokens, 0) });
  }
  const limit = settings.value.accounts.claudeLimit;
  return {
    active: !!active,
    sessionTokens,
    sessionStart: active ? blockStart : null,
    resetsAt: active ? blockStart + H5 : null,
    weekTokens,
    topModel: top ? prettyModel(top) : null,
    messages: session.length,
    limit: limit ?? null,
    percent: limit ? Math.min(100, Math.round((sessionTokens / limit) * 100)) : null,
    series,
    daily,
  };
}

function prettyModel(id: string): string {
  const m = /claude-(\w+)-(\d+)(?:-(\d+))?/.exec(id);
  if (!m) return id;
  return `${m[1][0].toUpperCase()}${m[1].slice(1)} ${m[2]}${m[3] && m[3].length < 3 ? "." + m[3] : ""}`;
}

// ---------- screen time: the app in front, minus idle time ----------

interface Day {
  total: number;
  hours: number[];
  apps: Record<string, number>;
}
interface ScreenTime {
  days: Record<string, Day>;
  names: Record<string, string>;
}
const stFile = join(app.getPath("userData"), "screentime.json");
let st: ScreenTime = { days: {}, names: {} };
try {
  st = JSON.parse(readFileSync(stFile, "utf8"));
} catch {
  /* first day */
}
let fgExe: string | null = null;
let fgName: string | null = null;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
let locked = false;

function tickScreenTime(seconds: number): void {
  if (locked || !fgExe) return;
  if (powerMonitor.getSystemIdleTime() >= 120) return;
  const k = dayKey();
  const day = (st.days[k] ??= { total: 0, hours: Array(24).fill(0), apps: {} });
  day.total += seconds;
  day.hours[new Date().getHours()] += seconds;
  day.apps[fgExe] = (day.apps[fgExe] ?? 0) + seconds;
}

async function screenTimeSummary() {
  const k = dayKey();
  const today = st.days[k] ?? { total: 0, hours: Array(24).fill(0), apps: {} };
  const apps = await Promise.all(
    Object.entries(today.apps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(async ([exe, seconds]) => ({ exe, seconds, name: st.names[exe] ?? basename(exe, extname(exe)), icon: await getIcon(exe, 32) })),
  );
  const week: { date: string; total: number }[] = [];
  const weekApps: Record<string, number> = {};
  for (let i = 6; i >= 0; i--) {
    const d = dayKey(new Date(Date.now() - i * 86400_000));
    const day = st.days[d];
    week.push({ date: d, total: day?.total ?? 0 });
    for (const [exe, s] of Object.entries(day?.apps ?? {})) weekApps[exe] = (weekApps[exe] ?? 0) + s;
  }
  const weekTop = await Promise.all(
    Object.entries(weekApps)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(async ([exe, seconds]) => ({ exe, seconds, name: st.names[exe] ?? basename(exe, extname(exe)), icon: await getIcon(exe, 32) })),
  );
  return { today: { total: today.total, hours: today.hours, apps }, week, weekApps: weekTop, current: fgName };
}

function saveScreenTime(): void {
  const keep = new Set(Array.from({ length: 30 }, (_, i) => dayKey(new Date(Date.now() - i * 86400_000))));
  for (const k of Object.keys(st.days)) if (!keep.has(k)) delete st.days[k];
  writeFileAtomic(stFile, JSON.stringify(st));
}

export function screenTimeToday(): number {
  return st.days[dayKey()]?.total ?? 0;
}

// ---------- files ----------

/** the newest n entries of a folder, read off the main thread (Downloads can hold thousands) */
async function latest(dir: string, filter: (f: string) => boolean, n: number) {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const items = await Promise.all(
    names
      .filter((f) => filter(f) && !f.startsWith("."))
      .map(async (f) => {
        try {
          const s = await stat(join(dir, f));
          return { name: f, path: join(dir, f), size: s.size, mtime: s.mtimeMs, dir: s.isDirectory() };
        } catch {
          return null;
        }
      }),
  );
  return items
    .filter((x): x is NonNullable<typeof x> => !!x)
    .sort((a, b) => b.mtime - a.mtime)
    .slice(0, n);
}

/** a recent file still there; one on a network share that doesn't answer soon counts as gone */
async function stillThere(path: string): Promise<boolean> {
  let t: NodeJS.Timeout | undefined;
  const late = new Promise<boolean>((r) => (t = setTimeout(() => r(false), 2000)));
  try {
    return await Promise.race([access(path).then(() => true, () => false), late]);
  } finally {
    clearTimeout(t);
  }
}

async function filesSummary() {
  const downloads = app.getPath("downloads");
  const shots = join(app.getPath("pictures"), "Screenshots");
  const recentDir = join(process.env.APPDATA ?? "", "Microsoft", "Windows", "Recent");
  const dl = await Promise.all(
    (await latest(downloads, (f) => !/\.(crdownload|part|tmp)$/i.test(f), 6)).map(async (f) => ({ ...f, icon: await getIcon(f.path, 32) })),
  );
  const ss = await Promise.all(
    (await latest(shots, (f) => /\.(png|jpe?g)$/i.test(f), 6)).map(async (f) => {
      let thumb: string | undefined;
      try {
        thumb = (await nativeImage.createThumbnailFromPath(f.path, { width: 240, height: 140 })).toDataURL();
      } catch {
        thumb = undefined;
      }
      return { ...f, thumb };
    }),
  );
  const targets = await Promise.all(
    (await latest(recentDir, (f) => f.toLowerCase().endsWith(".lnk"), 24)).map(async (f) => {
      try {
        const target = shell.readShortcutLink(f.path).target;
        return target && (await stillThere(target)) ? { name: basename(target), path: target, mtime: f.mtime } : null;
      } catch {
        return null;
      }
    }),
  );
  const recent = await Promise.all(
    targets
      .filter((x): x is NonNullable<typeof x> => !!x)
      .slice(0, 8)
      .map(async (f) => ({ ...f, icon: await getIcon(f.path, 32) })),
  );
  return { downloads: dl, screenshots: ss, recent };
}

export function initLocalTopics(): void {
  defineTopic("claude", poller(claudeSummary, 60_000));
  defineTopic("files", poller(filesSummary, 15_000));
  defineTopic("screentime", poller(screenTimeSummary, 30_000));

  host.on("foreground", async (f: { exe: string | null; app: boolean }) => {
    if (!f.exe) return;
    const exe = f.exe.toLowerCase();
    if (/\\(explorer|lockapp|searchhost|startmenuexperiencehost|shellexperiencehost)\.exe$/.test(exe) && !f.app) {
      return; // the desktop, Start and the lock screen aren't an app you spent time in
    }
    fgExe = f.exe;
    if (!st.names[f.exe]) {
      const n = await host.try<string | null>("exeName", { path: f.exe });
      st.names[f.exe] = n || basename(f.exe, extname(f.exe));
    }
    fgName = st.names[f.exe];
  });
  powerMonitor.on("lock-screen", () => (locked = true));
  powerMonitor.on("unlock-screen", () => (locked = false));
  powerMonitor.on("suspend", () => (locked = true));
  powerMonitor.on("resume", () => (locked = false));
  setInterval(() => tickScreenTime(5), 5000);
  setInterval(saveScreenTime, 60_000);
  app.on("before-quit", saveScreenTime);
}
