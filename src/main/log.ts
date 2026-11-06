// A short diary of starts, quits and crashes in %APPDATA%\VyseBar\vysebar.log, so a dock that
// didn't come up after signing in can be explained afterwards. Only VyseBar's own events go in
// it: no window titles, file names or anything you typed. It rolls over at 256 KB.
import { appendFileSync, renameSync, statSync } from "node:fs";
import { uptime } from "node:os";
import { join } from "node:path";
import { app } from "electron";

let file: string | null = null;

export function log(line: string): void {
  try {
    file ??= join(app.getPath("userData"), "vysebar.log");
    try {
      if (statSync(file).size > 256 * 1024) renameSync(file, `${file}.old`);
    } catch {
      /* no log yet */
    }
    appendFileSync(file, `${new Date().toISOString()} [${process.pid}] ${line}\n`);
  } catch {
    /* the log must never get in the way */
  }
}

/** called first thing, before the single-instance check */
export function initLog(): void {
  const flags = process.argv.slice(1).filter((a) => a.startsWith("--") && !a.includes("\\"));
  log(`start ${app.getVersion()} ${process.arch}, Windows up ${Math.round(uptime())} s${flags.length ? `, ${flags.join(" ")}` : ""}`);
  process.on("uncaughtException", (e) => {
    log(`error: ${(e as Error)?.stack ?? String(e)}`.slice(0, 2000));
    console.error(e);
  });
  process.on("unhandledRejection", (e) => log(`unhandled: ${(e as Error)?.message ?? String(e)}`.slice(0, 500)));
  app.on("child-process-gone", (_e, d) => log(`${d.type} process gone: ${d.reason} (${d.exitCode})`));
  app.on("render-process-gone", (_e, wc, d) => log(`page gone: ${d.reason} (${d.exitCode}) ${wc.getURL().split(/[?#]/)[0].split("/").pop()}`));
  app.on("will-quit", () => log("quitting"));
  process.on("exit", (code) => log(`exit ${code}`));
}
