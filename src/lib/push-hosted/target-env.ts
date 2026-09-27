import { readFileSync } from "node:fs";

/**
 * The hosted side's credentials, read from the file `vercel env pull` wrote
 * (`--to .env.hosted`). They are kept in a map — never copied into
 * `process.env`, so nothing else in the process (the local side, a library's
 * env fallback) can pick them up — and never printed: messages name the
 * variable, not its value, and {@link secretScrubber} strips values from any
 * error text a driver produces.
 */

export type EnvMap = Record<string, string>;

/** `KEY=value` lines as `vercel env pull` writes them: optional quotes, `#` comments, `export `. */
export function parseEnvFile(text: string): EnvMap {
  const env: EnvMap = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match) continue;
    const [, key, rest] = match;
    let value = rest.trim();
    if (value.startsWith('"')) {
      const end = value.lastIndexOf('"');
      value = value.slice(1, end > 0 ? end : undefined).replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (value.startsWith("'")) {
      const end = value.lastIndexOf("'");
      value = value.slice(1, end > 0 ? end : undefined);
    } else {
      value = value.replace(/\s+#.*$/, "");
    }
    env[key] = value;
  }
  return env;
}

export function readEnvFile(path: string): EnvMap {
  return parseEnvFile(readFileSync(path, "utf8"));
}

export type BlobCredentials =
  | { kind: "token"; token: string }
  | { kind: "oidc"; storeId: string; oidcToken: string };

export interface TargetCredentials {
  /** The variable the connection string came from (named in output; its value never is). */
  databaseVar: string;
  databaseUrl: string;
  /** Null when the file links no Blob store (fine when there are no files to carry). */
  blob: BlobCredentials | null;
  blobVar: string | null;
  /**
   * The private store, when the deployment links a second one with the prefix
   * `BLOB_PRIVATE` (data platform spec amendment "Public and private Blob
   * stores"): private files go there. Null means one store holds both.
   */
  privateBlob: BlobCredentials | null;
  privateBlobVar: string | null;
}

const present = (value: string | undefined): value is string => Boolean(value && value.trim());

/**
 * Pick the connection and the Blob credentials.
 *
 * - Database: `DATABASE_URL_UNPOOLED` when the Neon integration provided it (a
 *   direct connection suits one long transaction), else `DATABASE_URL`.
 * - Private Blob (optional): `BLOB_PRIVATE_READ_WRITE_TOKEN`, else
 *   `BLOB_PRIVATE_STORE_ID` + `VERCEL_OIDC_TOKEN`; private files go there.
 * - Blob: `BLOB_READ_WRITE_TOKEN` when present (it does not expire), else
 *   `BLOB_STORE_ID` + `VERCEL_OIDC_TOKEN` — what a store connected the current
 *   way gives `vercel env pull` (the OIDC token lasts about 12 hours; pull
 *   again if it has expired).
 */
export function resolveTargetCredentials(env: EnvMap): TargetCredentials {
  const databaseVar = present(env.DATABASE_URL_UNPOOLED) ? "DATABASE_URL_UNPOOLED" : "DATABASE_URL";
  const databaseUrl = env[databaseVar];
  if (!present(databaseUrl)) {
    throw new Error("The env file has no DATABASE_URL. Connect Neon to the project, then run `vercel env pull` again.");
  }
  if (!/^postgres(ql)?:\/\//.test(databaseUrl.trim())) {
    throw new Error(`${databaseVar} in the env file is not a postgres:// connection string.`);
  }

  let blob: BlobCredentials | null = null;
  let blobVar: string | null = null;
  if (present(env.BLOB_READ_WRITE_TOKEN)) {
    blob = { kind: "token", token: env.BLOB_READ_WRITE_TOKEN.trim() };
    blobVar = "BLOB_READ_WRITE_TOKEN";
  } else if (present(env.BLOB_STORE_ID) && present(env.VERCEL_OIDC_TOKEN)) {
    blob = { kind: "oidc", storeId: env.BLOB_STORE_ID.trim(), oidcToken: env.VERCEL_OIDC_TOKEN.trim() };
    blobVar = "BLOB_STORE_ID + VERCEL_OIDC_TOKEN";
  }
  let privateBlob: BlobCredentials | null = null;
  let privateBlobVar: string | null = null;
  if (present(env.BLOB_PRIVATE_READ_WRITE_TOKEN)) {
    privateBlob = { kind: "token", token: env.BLOB_PRIVATE_READ_WRITE_TOKEN.trim() };
    privateBlobVar = "BLOB_PRIVATE_READ_WRITE_TOKEN";
  } else if (present(env.BLOB_PRIVATE_STORE_ID) && present(env.VERCEL_OIDC_TOKEN)) {
    privateBlob = { kind: "oidc", storeId: env.BLOB_PRIVATE_STORE_ID.trim(), oidcToken: env.VERCEL_OIDC_TOKEN.trim() };
    privateBlobVar = "BLOB_PRIVATE_STORE_ID + VERCEL_OIDC_TOKEN";
  }
  return { databaseVar, databaseUrl: databaseUrl.trim(), blob, blobVar, privateBlob, privateBlobVar };
}

/**
 * A function that replaces every value from the env file (and the parts of a
 * connection string — user, password, host) found in `text` with `[redacted]`.
 * Applied to every error before it is printed.
 */
export function secretScrubber(env: EnvMap): (text: string) => string {
  const secrets = new Set<string>();
  for (const value of Object.values(env)) {
    const v = value.trim();
    if (v.length >= 6) secrets.add(v);
    if (/^postgres(ql)?:\/\//.test(v)) {
      try {
        const url = new URL(v);
        for (const part of [url.username, decodeURIComponent(url.password), url.password, url.host, url.hostname]) {
          if (part && part.length >= 4) secrets.add(part);
        }
      } catch {
        // not a URL after all; the whole value is already listed
      }
    }
  }
  const ordered = [...secrets].sort((a, b) => b.length - a.length);
  return (text: string) => {
    let out = text;
    for (const secret of ordered) if (out.includes(secret)) out = out.split(secret).join("[redacted]");
    return out;
  };
}
