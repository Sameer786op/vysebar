// The small files VyseBar keeps beside its settings (screen time, plan history, the icon
// cache) are written whole: the new text goes to a .tmp beside the file and replaces it in one
// rename, so a crash or a power cut mid-write leaves the old file rather than half a new one.
import { renameSync, rmSync, writeFileSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";

// files being written in the background, with the newest text still to go
const pending = new Map<string, { text: string | null }>();
const REMOVE = "\u0000remove";
// saves made on main's thread (quitting) per file: a background save begun before one, or text
// waiting for one, is older and leaves the file to it
const direct = new Map<string, number>();

/** true once saved; a failure (a virus scanner holding the file) is logged and tried again next
 * time. Holds main's thread until the disk has it: for quitting, when there is no later */
export function writeFileAtomic(file: string, text: string): boolean {
  direct.set(file, (direct.get(file) ?? 0) + 1);
  const waiting = pending.get(file);
  if (waiting) waiting.text = null;
  const tmp = `${file}.tmp`;
  try {
    writeFileSync(tmp, text);
    renameSync(tmp, file);
    return true;
  } catch (e) {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* gone already */
    }
    console.error(`VyseBar: couldn't save ${file}:`, (e as Error).message);
    return false;
  }
}

/** deletes the file, after any background write to it still on its way */
export function removeFileSoon(file: string): void {
  writeFileAtomicSoon(file, REMOVE);
}

/** the same, in the background (main's thread also carries the dock's pointer, and a busy disk
 * can take a moment). Writes to one file go one at a time; texts that pile up meanwhile are
 * skipped for the newest */
export function writeFileAtomicSoon(file: string, text: string): void {
  const p = pending.get(file);
  if (p) {
    p.text = text;
    return;
  }
  const job = { text: text as string | null };
  pending.set(file, job);
  void (async () => {
    try {
      while (job.text !== null) {
        const t = job.text;
        job.text = null;
        const before = direct.get(file) ?? 0;
        // overtaken by a save on main's thread: the file has newer text. The rename or delete
        // goes straight after this check, with nothing in between
        const overtaken = () => (direct.get(file) ?? 0) !== before;
        if (t === REMOVE) {
          try {
            if (!overtaken()) rmSync(file, { force: true });
          } catch {
            /* held by another program: it stays */
          }
          continue;
        }
        // a .tmp of its own: a save on main's thread meanwhile writes the other one
        const tmp = `${file}.tmp-soon`;
        for (let attempt = 0; attempt < 3; attempt++) {
          try {
            await writeFile(tmp, t);
            if (overtaken()) {
              await rm(tmp, { force: true }).catch(() => undefined);
              break;
            }
            renameSync(tmp, file);
            break;
          } catch (e) {
            await rm(tmp, { force: true }).catch(() => undefined);
            if (attempt === 2) console.error(`VyseBar: couldn't save ${file}:`, (e as Error).message);
            else await new Promise((r) => setTimeout(r, 250));
          }
        }
      }
    } finally {
      pending.delete(file);
    }
  })();
}
