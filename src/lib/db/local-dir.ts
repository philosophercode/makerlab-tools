import { resolve } from "node:path";

/**
 * `PGLITE_DATA_DIR` — a persistent PGlite database on this laptop, for
 * reviewing a real import (the Notion inventory) in the dev app before it goes
 * anywhere shared.
 *
 * Returns the absolute directory (relative values resolve against the working
 * directory, which is `v5/` under `next dev` and the npm scripts), or null when
 * the variable is unset or blank.
 *
 * Local only. On Vercel or in a production build a directory on one machine's
 * disk would be a database that silently vanishes with the instance, so the
 * variable is refused outright rather than ignored — a deploy that sets it
 * fails loudly instead of quietly serving the demo seed (Article 4).
 *
 * Not `server-only`: the import and migrate scripts load it under plain Node.
 */
export function localDataDir(): string | null {
  const raw = (process.env.PGLITE_DATA_DIR ?? "").trim();
  if (!raw) return null;
  if (process.env.VERCEL || process.env.NODE_ENV === "production") {
    throw new Error(
      "PGLITE_DATA_DIR is for local development only and is refused on Vercel and in production builds. " +
        "Unset it (a deploy uses DATABASE_URL)."
    );
  }
  return resolve(process.cwd(), raw);
}
