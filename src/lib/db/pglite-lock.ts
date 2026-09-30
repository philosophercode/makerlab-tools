import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * One process at a time on a `PGLITE_DATA_DIR` directory.
 *
 * PGlite is Postgres in WebAssembly inside *this* process; there is no server
 * to arbitrate between two of them. Two processes opening the same directory
 * (the dev server and `npm run import:notion`, say) would each believe they own
 * the files and corrupt them. PGlite itself does not guard against that on
 * Node, so this does: a `lock` file holding the owner's pid, created
 * exclusively. A lock whose pid is no longer running (a dev server killed with
 * Ctrl-C) is stale and taken over; one held by this same process is reused, so
 * a module reload or a second open in one test is not a conflict.
 */

export class PgliteLockedError extends Error {
  readonly dir: string;
  readonly pid: number;

  constructor(dir: string, pid: number) {
    super(
      `The local database at ${dir} is in use by process ${pid} ` +
        "(usually `npm run dev`). PGlite directories are single-process: stop that process and try again."
    );
    this.name = "PgliteLockedError";
    this.dir = dir;
    this.pid = pid;
  }
}

const held = new Set<string>();

function lockPath(dir: string): string {
  return join(dir, "lock");
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to someone else.
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

function readOwner(path: string): number | null {
  try {
    const pid = Number.parseInt(readFileSync(path, "utf8").trim(), 10);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Take the directory's lock, creating the directory if needed. Throws {@link PgliteLockedError}. */
export function acquirePgliteLock(dir: string): void {
  mkdirSync(dir, { recursive: true });
  const path = lockPath(dir);

  try {
    writeFileSync(path, String(process.pid), { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    const owner = readOwner(path);
    if (owner !== null && owner !== process.pid && isRunning(owner)) {
      throw new PgliteLockedError(dir, owner);
    }
    // Ours already, or stale: claim it.
    writeFileSync(path, String(process.pid));
  }

  if (!held.has(path)) {
    held.add(path);
    process.once("exit", () => releasePgliteLock(dir));
  }
}

/** Give the lock back, if this process still holds it. */
export function releasePgliteLock(dir: string): void {
  const path = lockPath(dir);
  held.delete(path);
  if (readOwner(path) !== process.pid) return;
  try {
    unlinkSync(path);
  } catch {
    // Already gone; nothing to release.
  }
}
