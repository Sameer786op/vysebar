// Gemini CLI and OpenCode usage, read from their own files on this PC: tokens today and over
// the week, replies, the model used most and (OpenCode) what it cost. Nothing is sent anywhere.
//
// Gemini CLI keeps each chat in ~/.gemini/tmp/<project>/chats/, as session-*.json (one object
// with a messages list) or, in newer versions, .jsonl (one record per line). Its replies carry
// `model` and `tokens` { input, output, cached, thoughts, tool, total }.
// OpenCode keeps everything in ~/.local/share/opencode/opencode.db (SQLite): replies are rows of
// `session_message` (v2) or the older `message` table, a JSON `data` column holding `tokens`
// { input, output, reasoning, cache { read, write } } and `cost`, and a `time_created` column.
// Before the database it wrote storage/message/<session>/msg_*.json files.
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { defineTopic, poller } from "../topics";

export interface LocalUsage {
  today: number;
  week: number;
  /** replies today */
  requests: number;
  daily: { date: string; tokens: number }[];
  topModel: string | null;
  /** dollars over the week, when the tool records it */
  cost: number | null;
  /** the newest reply */
  at: number | null;
}

const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/** adds up a week of replies, day by day */
function tally() {
  const days = Array.from({ length: 7 }, (_, i) => localDay(Date.now() - (6 - i) * 86400_000));
  const byDay = new Map(days.map((d) => [d, 0]));
  const models = new Map<string, number>();
  const today = days[6];
  let requests = 0;
  let cost = 0;
  let costSeen = false;
  let at: number | null = null;
  return {
    since: new Date(days[0] + "T00:00").getTime(),
    add(t: number, tokens: number, model: string | null, dollars?: number) {
      const d = localDay(t);
      if (!byDay.has(d)) return;
      byDay.set(d, byDay.get(d)! + tokens);
      if (d === today) requests++;
      if (model) models.set(model, (models.get(model) ?? 0) + tokens);
      if (dollars != null && Number.isFinite(dollars) && dollars > 0) {
        cost += dollars;
        costSeen = true;
      }
      if (!at || t > at) at = t;
    },
    result(): LocalUsage {
      const daily = days.map((date) => ({ date, tokens: byDay.get(date)! }));
      const top = [...models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
      return { today: byDay.get(today)!, week: daily.reduce((s, d) => s + d.tokens, 0), requests, daily, topModel: top, cost: costSeen ? cost : null, at };
    },
  };
}

const parse = (text: string): any => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

/** files under dir changed since `since`, one folder level down */
async function recentFiles(dir: string, since: number, test: (name: string) => boolean): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return out;
  }
  for (const name of names) {
    if (!test(name)) continue;
    const p = join(dir, name);
    try {
      if ((await stat(p)).mtimeMs >= since) out.push(p);
    } catch {
      /* gone */
    }
  }
  return out;
}

// ---------- Gemini CLI ----------

async function geminiUsage(): Promise<LocalUsage | { error: string }> {
  const root = join(process.env.GEMINI_CLI_HOME ?? homedir(), ".gemini", "tmp");
  if (!existsSync(root)) return { error: "Gemini CLI isn't on this PC" };
  const t = tally();
  const files: string[] = [];
  for (const project of await readdir(root).catch(() => [] as string[])) files.push(...(await recentFiles(join(root, project, "chats"), t.since, (f) => /\.jsonl?$/.test(f))));
  // a reply can be written more than once as it streams: the last copy of each id counts
  const replies = new Map<string, any>();
  let anon = 0;
  for (const f of files) {
    const text = await readFile(f, "utf8").catch(() => "");
    const records: any[] = f.endsWith(".jsonl") ? text.split("\n").filter(Boolean).map(parse) : (parse(text)?.messages ?? []);
    for (const r of records) {
      const m = r?.tokens ? r : r?.message?.tokens ? r.message : null;
      if (!m || (m.type && m.type !== "gemini")) continue;
      replies.set(m.id ? `${f}:${m.id}` : `#${anon++}`, m);
    }
  }
  for (const m of replies.values()) {
    const when = Date.parse(m.timestamp ?? "");
    if (!Number.isFinite(when)) continue;
    const k = m.tokens;
    const tokens = k.total != null ? n(k.total) : n(k.input) + n(k.output) + n(k.thoughts) + n(k.tool);
    t.add(when, tokens, typeof m.model === "string" ? m.model : null);
  }
  return t.result();
}

// ---------- OpenCode ----------

function opencodeHomes(): string[] {
  const homes = [join(process.env.XDG_DATA_HOME ?? join(homedir(), ".local", "share"), "opencode")];
  if (process.env.LOCALAPPDATA) homes.push(join(process.env.LOCALAPPDATA, "opencode"));
  if (process.env.APPDATA) homes.push(join(process.env.APPDATA, "opencode"));
  return homes;
}

const tokensOf = (k: any) => n(k?.input) + n(k?.output) + n(k?.reasoning) + n(k?.cache?.read) + n(k?.cache?.write);

function readDatabase(file: string, t: ReturnType<typeof tally>): boolean {
  // Node's built-in SQLite, opened read-only so OpenCode can keep writing
  const sqlite = (process as any).getBuiltinModule?.("node:sqlite") as typeof import("node:sqlite") | undefined;
  if (!sqlite) return false;
  const db = new sqlite.DatabaseSync(file, { readOnly: true });
  try {
    const has = (name: string) => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    // time_created is in milliseconds; an older build may have used seconds
    const scale = (table: string) => (n((db.prepare(`SELECT max(time_created) AS m FROM ${table}`).get() as any)?.m) < 1e12 ? 1000 : 1);
    let found = false;
    if (has("session_message")) {
      const s = scale("session_message");
      for (const row of db.prepare("SELECT data, time_created FROM session_message WHERE type = 'assistant' AND time_created >= ?").all(t.since / s) as any[]) {
        const d = parse(String(row.data));
        if (!d?.tokens) continue;
        t.add(n(row.time_created) * s, tokensOf(d.tokens), d.model?.id ?? d.modelID ?? null, n(d.cost));
        found = true;
      }
    }
    // the v1 table, which v2 stopped writing to: only read when v2 had nothing
    if (!found && has("message")) {
      const s = scale("message");
      for (const row of db.prepare(`SELECT data, time_created FROM message WHERE data LIKE '%"tokens"%' AND time_created >= ?`).all(t.since / s) as any[]) {
        const d = parse(String(row.data));
        if (!d?.tokens || (d.role && d.role !== "assistant")) continue;
        t.add(n(row.time_created) * s, tokensOf(d.tokens), d.modelID ?? d.model?.id ?? null, n(d.cost));
      }
    }
    return true;
  } finally {
    db.close();
  }
}

async function readStorage(dir: string, t: ReturnType<typeof tally>): Promise<void> {
  for (const session of await recentFiles(dir, t.since, () => true)) {
    for (const f of await recentFiles(session, t.since, (x) => x.endsWith(".json"))) {
      const d = parse(await readFile(f, "utf8").catch(() => ""));
      if (!d?.tokens || d.role !== "assistant") continue;
      const when = n(d.time?.created);
      if (when) t.add(when < 1e12 ? when * 1000 : when, tokensOf(d.tokens), d.modelID ?? null, n(d.cost));
    }
  }
}

async function opencodeUsage(): Promise<LocalUsage | { error: string }> {
  const t = tally();
  const env = process.env.OPENCODE_DB;
  const homes = opencodeHomes().filter((h) => existsSync(h));
  const db = env && existsSync(env) ? env : homes.map((h) => join(h, "opencode.db")).find((f) => existsSync(f));
  if (!db && !homes.length) return { error: "OpenCode isn't on this PC" };
  let read = false;
  if (db) {
    try {
      read = readDatabase(db, t);
    } catch (e) {
      console.error("opencode usage:", (e as Error).message);
    }
  }
  if (!read) for (const h of homes) await readStorage(join(h, "storage", "message"), t);
  return t.result();
}

const safe = (fn: () => Promise<LocalUsage | { error: string }>) => async () => {
  try {
    return await fn();
  } catch (e) {
    return { error: `Couldn't read the logs: ${(e as Error).message}` };
  }
};

export function initLocalAiTopics(): void {
  defineTopic("gemini", poller(safe(geminiUsage), 2 * 60_000));
  defineTopic("opencode", poller(safe(opencodeUsage), 2 * 60_000));
}
