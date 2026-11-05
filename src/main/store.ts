// Settings and widget data, each a JSON file in userData, written a moment after a change.
// Writes are crash-proof: the new file is written beside the old one and flushed to disk
// before it replaces it, and the version before that stays as .bak. A file that can't be
// read (a power cut on a disk that lied about flushing) falls back to the .bak instead of
// resetting everything, and is kept aside rather than overwritten.
import { closeSync, copyFileSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { DEFAULT_DATA, DEFAULT_SETTINGS, type Data, type Settings } from "@shared/types";
import { broadcast } from "./broadcast";

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readJson(file: string): object | null {
  // right after Windows starts, a virus scanner or backup tool can hold the file for a moment;
  // wait for it (up to 3 s, before any window exists) rather than start from the defaults
  for (let attempt = 0; ; attempt++) {
    let text: string;
    try {
      text = readFileSync(file, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if ((code === "EBUSY" || code === "EPERM" || code === "EACCES") && attempt < 30) {
        pause(100);
        continue;
      }
      return null;
    }
    try {
      const v = JSON.parse(text);
      return v && typeof v === "object" && !Array.isArray(v) ? v : null;
    } catch {
      return null;
    }
  }
}

class JsonFile<T extends object> {
  value: T;
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private retries = 0;
  private listeners = new Set<(v: T, prev: T) => void>();

  constructor(
    private file: string,
    defaults: T,
    private channel: string,
  ) {
    let loaded = readJson(file);
    if (!loaded && existsSync(file)) {
      // unreadable: keep it for a look later, and start from the copy before it
      try {
        renameSync(file, `${file}.broken-${Date.now()}`);
      } catch {
        /* still locked: it gets replaced on the next save, the .bak keeps the last good one */
      }
    }
    if (!loaded) loaded = readJson(file + ".bak");
    this.value = mergeDefaults(defaults, (loaded ?? {}) as Partial<T>);
  }

  set(patch: Partial<T>): T {
    const prev = this.value;
    this.value = { ...this.value, ...patch };
    this.save();
    broadcast(this.channel, this.value);
    for (const l of this.listeners) l(this.value, prev);
    return this.value;
  }

  onChange(fn: (v: T, prev: T) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private save(delay = 300): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  /** writes now if anything changed; on quit `final` falls back to an in-place write */
  flush(final = false): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!this.dirty) return;
    const text = JSON.stringify(this.value, null, 1);
    const tmp = this.file + ".tmp";
    try {
      const fd = openSync(tmp, "w");
      try {
        writeSync(fd, text);
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }
      if (existsSync(this.file)) copyFileSync(this.file, this.file + ".bak");
      renameSync(tmp, this.file);
      this.dirty = false;
      this.retries = 0;
    } catch (err) {
      // usually a virus scanner or backup tool holding the file for a moment
      if (final) {
        try {
          writeFileSync(this.file, text);
          this.dirty = false;
        } catch {
          /* nothing more to try */
        }
        try {
          unlinkSync(tmp);
        } catch {
          /* gone already */
        }
        return;
      }
      if (this.retries++ < 40) this.save(Math.min(250 * this.retries, 3000));
      else console.error(`VyseBar: couldn't save ${this.file}`, err);
    }
  }
}

function mergeDefaults<T extends object>(defaults: T, loaded: Partial<T>): T {
  const out = { ...defaults } as Record<string, unknown>;
  for (const [k, v] of Object.entries(loaded)) {
    const d = (defaults as Record<string, unknown>)[k];
    if (v && d && typeof v === "object" && typeof d === "object" && !Array.isArray(v) && !Array.isArray(d)) {
      out[k] = { ...(d as object), ...(v as object) };
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

const dir = app.getPath("userData");
export const settings = new JsonFile<Settings>(join(dir, "settings.json"), DEFAULT_SETTINGS, "settings");
export const data = new JsonFile<Data>(join(dir, "data.json"), DEFAULT_DATA, "data");

/** writes everything still waiting; safe to call any number of times */
export function flushAll(): void {
  settings.flush(true);
  data.flush(true);
}
