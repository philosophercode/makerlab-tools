import { eq, sql } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { user } from "../db/schema/auth.ts";
import { labSettings } from "../db/schema/lab-settings.ts";
import type { Db } from "../db/types.ts";

/**
 * `lab_settings` (migration `0024`): one JSON value per key, per deployment.
 * The reader validates; this module only stores. Relative imports with `.ts`
 * extensions, no `"server-only"`, like every module under `src/lib/data/`.
 */

export const VALUE_REPORT_SETTING = "value_report";

export interface LabSetting {
  value: unknown;
  updatedAt: string;
  /** The staff member who last changed it, or null once their account is gone. */
  updatedByName: string | null;
}

export async function getLabSetting(key: string, options: { db?: Db } = {}): Promise<LabSetting | null> {
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({ value: labSettings.value, updatedAt: labSettings.updatedAt, updatedByName: user.name })
    .from(labSettings)
    .leftJoin(user, eq(user.id, labSettings.updatedBy))
    .where(eq(labSettings.key, key))
    .limit(1);
  if (!row) return null;
  return { value: row.value, updatedAt: new Date(row.updatedAt).toISOString(), updatedByName: row.updatedByName ?? null };
}

/** Insert or replace one setting. Answers whether the stored value changed. */
export async function setLabSetting(key: string, value: unknown, actorUserId: string | null, options: { db?: Db } = {}): Promise<{ changed: boolean }> {
  const db = options.db ?? (await getDb());
  return db.transaction(async (tx) => {
    const [current] = await tx.select({ value: labSettings.value }).from(labSettings).where(eq(labSettings.key, key)).limit(1);
    if (current && stableJson(current.value) === stableJson(value)) return { changed: false };
    await tx
      .insert(labSettings)
      .values({ key, value, updatedBy: actorUserId })
      .onConflictDoUpdate({ target: labSettings.key, set: { value, updatedBy: actorUserId, updatedAt: sql`now()` } });
    return { changed: true };
  });
}

/** JSON with object keys sorted — `jsonb` does not keep the order they were written in. */
function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)))
      : v
  );
}
