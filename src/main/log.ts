// A short diary of starts, quits and crashes in %APPDATA%\VyseBar\vysebar.log, so a dock that
// didn't come up after signing in can be explained afterwards. Only VyseBar's own events go in
// it: no window titles, file names or anything you typed. It rolls over at 256 KB.
//
// Lines are written in the background: VyseBar's main thread also carries the dock's pointer,
// and a disk busy with Windows paging (a PC short of memory) can take a moment over a write.
// The last lines before VyseBar ends (quitting, Windows shutting down, a crash) go in at once.
import { appendFileSync, renameSync, statSync } from "node:fs";
import { appendFile, rename, stat } from "node:fs/promises";
import { uptime } from "node:os";
import { join } from "node:path";
import { app } from "electron";

const LIMIT = 256 * 1024;
let file: string | null = null;
let queue: string[] = [];
let writing = false;
let size = -1;

const path = (): string => (file ??= join(app.getPath("userData"), "vysebar.log"));
const stamp = (line: string): string => `${new Date().toISOString()} [${process.pid}] ${line}\n`;

export function log(line: string): void {
  try {
    queue.push(stamp(line));
    if (!writing) void drain();
  } catch {
    /* the log must never get in the way */
  }
}

async function drain(): Promise<void> {
  writing = true;
  try {
    while (queue.length) {
      const text = queue.join("");
      queue = [];
      const f = path();
      if (size < 0) size = await stat(f).then((s) => s.size, () => 0);
      if (size > LIMIT) {
        await rename(f, `${f}.old`).catch(() => undefined);
        size = 0;
      }
      await appendFile(f, text);
      size += Buffer.byteLength(text);
    }
  } catch {
    /* the log must never get in the way */
  } finally {
    writing = false;
  }
}

/** a line that must be on disk before VyseBar goes on (it's about to end), with any still waiting */
export function logNow(line: string): void {
  try {
    const text = queue.join("") + stamp(line);
    queue = [];
    const f = path();
    try {
      if (statSync(f).size > LIMIT) renameSync(f, `${f}.old`);
    } catch {
      /* no log yet */
    }
    appendFileSync(f, text);
    size = -1;
  } catch {
    /* the log must never get in the way */
  }
}

/** called first thing, before the single-instance check */
export function initLog(): void {
  const flags = process.argv.slice(1).filter((a) => a.startsWith("--") && !a.includes("\\"));
  log(`start ${app.getVersion()} ${process.arch}, Windows up ${Math.round(uptime())} s${flags.length ? `, ${flags.join(" ")}` : ""}`);
  process.on("uncaughtException", (e) => {
    logNow(`error: ${(e as Error)?.stack ?? String(e)}`.slice(0, 2000));
    console.error(e);
  });
  process.on("unhandledRejection", (e) => log(`unhandled: ${(e as Error)?.message ?? String(e)}`.slice(0, 500)));
  app.on("child-process-gone", (_e, d) => log(`${d.type} process gone: ${d.reason} (${d.exitCode})`));
  app.on("render-process-gone", (_e, wc, d) => log(`page gone: ${d.reason} (${d.exitCode}) ${wc.getURL().split(/[?#]/)[0].split("/").pop()}`));
  app.on("will-quit", () => logNow("quitting"));
  process.on("exit", (code) => logNow(`exit ${code}`));
}
