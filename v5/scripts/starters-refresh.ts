/**
 * Pre-run the assistant's starter chips (starter answers):
 *
 *   npm run starters:refresh -- [--dry-run] [--apply] [--limit N] [--ids a,b] [--general]
 *                               [--force] [--concurrency N] [--rounds N] [--out report.json]
 *
 * Asks every chip's question through the real chat pipeline as an anonymous
 * visitor, grades each answer, rewrites weak questions from what the tool's
 * record and searchable manuals cover (at most two rounds), and with
 * `--apply` stores the answers (`starter_answers`) and the tools' new
 * questions. `--dry-run` is the default and writes nothing. See
 * `src/lib/starters/args.ts` for every flag.
 *
 * This wrapper only checks the arguments and starts the task under Vitest
 * (`scripts/starters/refresh.task.ts`), which is how the task reaches the
 * app's modules — the same way `npm run eval` does.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parseRefreshArgs, REFRESH_USAGE } from "../src/lib/starters/args.ts";

const argv = process.argv.slice(2);
try {
  parseRefreshArgs(argv);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  console.error(REFRESH_USAGE);
  process.exit(2);
}

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const child = spawn(
  process.execPath,
  [path.join(root, "node_modules/vitest/vitest.mjs"), "run", "--config", "scripts/starters/vitest.config.ts"],
  { cwd: root, stdio: "inherit", env: { ...process.env, STARTERS_REFRESH_ARGS: JSON.stringify(argv) } }
);
child.on("exit", (code) => process.exit(code ?? 1));
