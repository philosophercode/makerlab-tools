import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * The ideal-lab eval's stage cache: a stage's output is kept on disk under a
 * key made of everything that could change it — its input, the model ids, and
 * the source of the code it runs. Change the read prompt and research runs
 * again; change only a judge and nothing is paid for but the judge.
 *
 * `EVAL_IL_FRESH=1` ignores the cache (and refills it). Gitignored; delete the
 * folder to start over.
 */

export function hashOf(value: unknown): string {
  return createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex").slice(0, 16);
}

/** One hash over the text of every `.ts` file (tests excluded) under `dirs` and in `files`, minus `exclude`. */
export async function sourceFingerprint(root: string, dirs: readonly string[], files: readonly string[] = [], exclude: readonly RegExp[] = []): Promise<string> {
  const paths: string[] = [...files];
  for (const dir of dirs) {
    const walk = async (relative: string) => {
      for (const entry of await readdir(path.join(root, relative), { withFileTypes: true })) {
        const child = path.join(relative, entry.name);
        if (entry.isDirectory()) await walk(child);
        else if (entry.name.endsWith(".ts") && !/\.test(-helpers)?\.ts$/.test(entry.name)) paths.push(child);
      }
    };
    await walk(dir);
  }
  const kept = [...new Set(paths)].filter((file) => !exclude.some((pattern) => pattern.test(file))).sort();
  const hash = createHash("sha256");
  for (const file of kept) {
    hash.update(file);
    hash.update(await readFile(path.join(root, file)));
  }
  return hash.digest("hex").slice(0, 16);
}

export class StageCache {
  private readonly dir: string;
  private readonly fresh: boolean;

  constructor(dir: string, fresh: boolean) {
    this.dir = dir;
    this.fresh = fresh;
  }

  private file(stage: string, caseId: string, key: string) {
    return path.join(this.dir, caseId, `${stage}-${key}.json`);
  }

  async get<T>(stage: string, caseId: string, key: string): Promise<T | null> {
    if (this.fresh) return null;
    try {
      return JSON.parse(await readFile(this.file(stage, caseId, key), "utf8")) as T;
    } catch {
      return null;
    }
  }

  async put(stage: string, caseId: string, key: string, value: unknown): Promise<void> {
    const file = this.file(stage, caseId, key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(value));
  }
}

/**
 * Dollars the Gateway reported for the calls a stage made. The app's research
 * code logs each call's cost (`describeGatewayCall`: "cost $0.0012") and
 * returns none, so the eval reads its own console while the stage runs rather
 * than change what research returns.
 */
export async function withCostMeter<T>(run: () => Promise<T>): Promise<{ value: T; cost: number }> {
  let cost = 0;
  const original = { info: console.info, warn: console.warn, log: console.log };
  const meter =
    (write: (...args: unknown[]) => void) =>
    (...args: unknown[]) => {
      for (const arg of args) {
        if (typeof arg !== "string") continue;
        for (const match of arg.matchAll(/\bcost \$(\d+(?:\.\d+)?)/g)) cost += Number(match[1]);
      }
      write(...args);
    };
  console.info = meter(original.info);
  console.warn = meter(original.warn);
  console.log = meter(original.log);
  try {
    const value = await run();
    return { value, cost };
  } finally {
    console.info = original.info;
    console.warn = original.warn;
    console.log = original.log;
  }
}
