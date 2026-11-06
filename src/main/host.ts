// Talks to VyseHost.exe, the native helper: one JSON line per command or event.
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { app } from "electron";

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };

class Host extends EventEmitter {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private quitting = false;
  private restarts = 0;

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
    createInterface({ input: proc.stdout }).on("line", (line) => this.onLine(line));
    proc.stderr.on("data", (d) => console.error("[host]", String(d).trim()));
    proc.on("exit", (code) => {
      this.proc = null;
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
      // a crash loop backs off instead of spinning
      const delay = Math.min(30_000, 500 * 2 ** this.restarts++);
      setTimeout(() => {
        this.start();
        this.emit("restarted");
      }, delay);
    });
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
    if (msg.type === "ready") this.restarts = 0;
    if (msg.type === "log") console.log("[host]", msg.data);
    this.emit(msg.type, msg.data);
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
