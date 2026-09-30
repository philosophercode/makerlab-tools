/**
 * Re-point URLs in a hosted database that name a Blob store other than the
 * deployment's own — the store deleted and recreated on 2026-09-27 — at the
 * copies the deployment's store holds now (manual text spec amendment
 * 2026-09-28 "Citations always resolve"; `src/lib/push-hosted/repoint.ts`).
 *
 *   vercel env pull .env.hosted --environment=production
 *   npm run blob:repoint -- --to .env.hosted            # dry run: report only
 *   npm run blob:repoint -- --to .env.hosted --apply    # write, one transaction
 *
 * The env file gives `DATABASE_URL` and the Blob store(s) — only their ids are
 * used, to tell the deployment's store from any other; nothing is uploaded.
 * Values are never printed and never enter `process.env`.
 *
 * Flags:
 *   --to <file>   the env file from `vercel env pull` (required)
 *   --apply       write the changes (default: a dry run that writes nothing)
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Pool, type PoolClient } from "@neondatabase/serverless";
import { runRepoint } from "../src/lib/push-hosted/repoint.ts";
import { sqlClient } from "../src/lib/push-hosted/sql.ts";
import { readEnvFile, resolveTargetCredentials, secretScrubber, storeHosts } from "../src/lib/push-hosted/target-env.ts";

export interface RepointArgs {
  to: string | null;
  apply: boolean;
}

export function parseRepointArgs(argv: string[]): RepointArgs {
  const args: RepointArgs = { to: null, apply: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--to") args.to = argv[++i] ?? null;
    else if (arg.startsWith("--to=")) args.to = arg.slice("--to=".length);
    else if (arg === "--apply") args.apply = true;
    else if (arg === "--dry-run") args.apply = false;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

const USAGE = "Usage: npm run blob:repoint -- --to <env file> [--apply]";

async function main(): Promise<number> {
  const args = parseRepointArgs(process.argv.slice(2));
  if (!args.to) {
    console.error(USAGE);
    return 2;
  }
  const envPath = resolve(process.cwd(), args.to);
  if (!existsSync(envPath)) {
    console.error(`No env file at ${args.to}. Create it with: vercel env pull ${args.to} --environment=production`);
    return 2;
  }
  const env = readEnvFile(envPath);
  const scrub = secretScrubber(env);
  const credentials = resolveTargetCredentials(env);
  const hosts = storeHosts(credentials.blob, credentials.privateBlob);
  if (hosts.length === 0) {
    console.error("The env file names no Blob store (BLOB_READ_WRITE_TOKEN, or BLOB_STORE_ID): nothing to compare against.");
    return 2;
  }

  console.log(args.apply ? "APPLY — rows will be updated in one transaction.\n" : "DRY RUN — nothing will be written.\n");
  const pool = new Pool({ connectionString: credentials.databaseUrl });
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    const report = await runRepoint({
      target: sqlClient(client),
      targetHosts: hosts,
      apply: args.apply,
      log: (line) => console.log(scrub(line)),
    });
    if (!args.apply && report.changes.length > 0) console.log("\nDry run complete: nothing was written. Run again with --apply.");
    return 0;
  } catch (error) {
    console.error(`\nFailed: ${scrub(error instanceof Error ? error.message : String(error))}`);
    console.error(args.apply ? "The transaction was rolled back; the database is as it was." : "Nothing was written.");
    return 1;
  } finally {
    client?.release();
    await pool.end().catch(() => {});
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    });
}
