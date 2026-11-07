// The small files VyseBar keeps beside its settings (screen time, plan history, the icon
// cache) are written whole: the new text goes to a .tmp beside the file and replaces it in one
// rename, so a crash or a power cut mid-write leaves the old file rather than half a new one.
import { renameSync, rmSync, writeFileSync } from "node:fs";

/** true once saved; a failure (a virus scanner holding the file) is logged and tried again next time */
export function writeFileAtomic(file: string, text: string): boolean {
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
