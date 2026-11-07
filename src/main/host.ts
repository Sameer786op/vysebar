// Talks to VyseHost.exe, the native helper: one JSON line per command or event.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";
import { log } from "./log";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

/** VyseBar's own command line, quoted the way Windows splits it, for starting it again */
function commandLine(args: string[]): string {
  return args.map((a) => (a && !/[\s"]/.test(a) ? a : `"${a.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1")}"`)).join(" ");
}

// the helper restarts a VyseBar that has stopped answering (see Watchdog.cs); in a development
// copy only when asked, since a paused debugger looks the same
const watchdogOn = app.isPackaged || process.env.VYSE_WATCHDOG === "1";

class Host extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private quitting = false;
  private restarts = 0;
  /** the helper has said it's ready, and hasn't gone since */
  ready = false;
  private health: NodeJS.Timeout | null = null;
  private misses = 0;
  private checking = false;

  private exePath(): string {
    const packed = join(process.resourcesPath, "bin", "VyseHost.exe");
    if (app.isPackaged && existsSync(packed)) return packed;
    return join(app.getAppPath(), "resources", "bin", "VyseHost.exe");
  }

  start(): void {
    const exe = this.exePath();
    if (!existsSync(exe)) {
      console.error("VyseHost.exe is missing - run `npm run host`");
      return;
    }
    const proc = spawn(exe, ["--parent", String(process.pid), "--data", app.getPath("userData")], {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
      // outside Electron's kill-on-exit job: if VyseBar crashes, the helper outlives it just
      // long enough to see stdin close and put the taskbar back
      detached: true,
    });
    this.proc = proc;
    let gone = false;
    const onGone = (code: number | null) => {
      if (gone) return;
      gone = true;
      if (this.proc === proc) this.proc = null;
      this.ready = false;
      // an exit code that is a Windows error status (0xC0000005 and the like) is a crash, not
      // Windows closing it at shutdown or VyseBar stopping it
      const crashed = typeof code === "number" && code >>> 0 >= 0xc0000000;
      for (const p of this.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error(this.quitting ? "host stopped" : crashed ? "host crashed" : "host exited"));
      }
      this.pending.clear();
      if (this.quitting) return;
      console.error(`[host] exited with ${code}, restarting`);
      if (crashed) log(`helper crashed (${(code! >>> 0).toString(16)}): starting it again`);
      // a crash loop backs off instead of spinning
      const delay = Math.min(30_000, 500 * 2 ** this.restarts++);
      setTimeout(() => {
        this.start();
        this.emit("restarted");
      }, delay);
    };
    createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line));
    proc.stderr.on("data", (d) => console.error("[host]", String(d).trim()));
    // a helper that can't be started at all (an antivirus holding the file) is tried again later
    proc.on("error", (err) => {
      log(`helper: ${(err as NodeJS.ErrnoException).code ?? err.message}`);
      if (proc.pid === undefined) onGone(null);
    });
    proc.on("exit", (code) => onGone(code));
    // stdin errors (the helper gone mid-write) are the exit handler's business
    proc.stdin.on("error", () => undefined);
    this.watchHealth();
  }

  private onLine(line: string): void {
    let msg: { type: string; id?: number; ok?: boolean; result?: unknown; error?: string; data?: unknown };
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.type === "reply" && msg.id != null) {
      const p = this.pending.get(msg.id);
      if (!p) return;
      this.pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.ok) p.resolve(msg.result);
      else p.reject(new Error(msg.error ?? "host error"));
      return;
    }
    if (msg.type === "ready") {
      this.restarts = 0;
      this.ready = true;
      this.misses = 0;
      if (watchdogOn) {
        const args = process.argv.slice(1).filter((a) => a !== "--updated" && a !== "--recovered");
        void this.try("watchdog", { exe: process.execPath, args: commandLine([...args, "--recovered"]), cwd: process.cwd(), seconds: 45 });
      }
    }
    if (msg.type === "log") {
      console.log("[host]", msg.data);
      log(`helper: ${String(msg.data).slice(0, 400)}`);
    }
    this.emit(msg.type, msg.data);
  }

  // The helper must keep answering. A command it never answers, or a window thread that stays
  // busy, means it is stuck, and everything that goes through it stops: bringing apps forward,
  // the list of open windows, volume, the tray. Then it is ended and started again, as after a crash.
  private watchHealth(): void {
    this.health ??= setInterval(() => void this.checkHealth(), 10_000);
  }

  private async checkHealth(): Promise<void> {
    const proc = this.proc;
    if (!proc || !this.ready || this.checking || this.quitting) return;
    this.checking = true;
    try {
      await Promise.all([this.call("ping", {}, 8000), this.call("uiPing", {}, 8000)]);
      this.misses = 0;
    } catch (err) {
      // three in a row: one miss can be VyseBar's own thread having been held up
      if (this.proc !== proc || ++this.misses < 3) return;
      this.misses = 0;
      log(`the helper stopped answering (${(err as Error).message}): restarting it`);
      proc.kill();
    } finally {
      this.checking = false;
    }
  }

  call<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs = 10_000): Promise<T> {
    const proc = this.proc;
    if (!proc) return Promise.reject(new Error("host not running"));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`host ${cmd} timed out`));
      }, timeoutMs);
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
      proc.stdin.write(JSON.stringify({ id, cmd, args }) + "\n");
    });
  }

  /** a call whose failure is not worth more than null */
  async try<T = unknown>(cmd: string, args: Record<string, unknown> = {}, timeoutMs?: number): Promise<T | null> {
    try {
      return await this.call<T>(cmd, args, timeoutMs);
    } catch {
      return null;
    }
  }

  /** stops the helper and resolves once it has exited (or after `ms`) */
  stopAndWait(ms = 4000): Promise<void> {
    const proc = this.proc;
    this.stop();
    if (!proc || proc.exitCode !== null) return Promise.resolve();
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      proc.once("exit", () => {
        clearTimeout(t);
        resolve();
      });
    });
  }

  stop(): void {
    this.quitting = true;
    // closing stdin makes the helper restore the taskbar and exit on its own
    try {
      this.proc?.stdin.end();
    } catch {
      /* already gone */
    }
  }
}

export const host = new Host();
