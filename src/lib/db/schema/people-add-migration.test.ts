// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { user } from "./auth";

/**
 * Migration `0018` ("Add person"): `user.first_signed_in_at`, null only for
 * somebody a super admin added who has not signed in yet.
 *
 * Every row that existed before it signed in to exist, so the backfill makes
 * its first sign-in its creation. Tested by running **the backfill statement
 * read from the migration file** against rows written the way they looked
 * before, as the `0016` test does.
 */

function backfill(): string {
  const file = readFileSync(join(migrationsFolder(), "0018_people_add.sql"), "utf8");
  const statement = file
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .find((part) => part.startsWith("UPDATE"));
  expect(statement).toBeDefined();
  return statement as string;
}

describe("migration 0018 — first_signed_in_at", () => {
  it("backfills every existing row with its creation time", async () => {
    const db = await createPgliteDb();
    const created = new Date("2026-03-04T10:00:00.000Z");
    await db.insert(user).values({ id: "u-old", name: "Old Timer", email: "old@cornell.edu", createdAt: created });
    // What the row looked like before `0018`: no first sign-in recorded.
    await db.update(user).set({ firstSignedInAt: null }).where(eq(user.id, "u-old"));

    await db.execute(sql.raw(backfill()));

    const [row] = await db.select().from(user).where(eq(user.id, "u-old"));
    expect(row.firstSignedInAt?.toISOString()).toBe(created.toISOString());
  });

  it("defaults a new row to now — a row created at sign-in is that sign-in", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-new", name: "New", email: "new@cornell.edu" });
    const [row] = await db.select().from(user).where(eq(user.id, "u-new"));
    expect(row.firstSignedInAt).toBeInstanceOf(Date);
  });

  it("keeps an explicit null — somebody added who has not signed in", async () => {
    const db = await createPgliteDb();
    await db.insert(user).values({ id: "u-added", name: "added@cornell.edu", email: "added@cornell.edu", firstSignedInAt: null });
    const [row] = await db.select().from(user).where(eq(user.id, "u-added"));
    expect(row.firstSignedInAt).toBeNull();
  });
});
