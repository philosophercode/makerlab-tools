// @vitest-environment node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { eq, sql } from "drizzle-orm";
import { expectViolation } from "../../../../test/db";
import { migrationsFolder } from "../migrations-folder";
import { createPgliteDb } from "../pglite";
import { attachments } from "./attachments";
import { ATTACHMENT_ORIGIN } from "./vocabulary";
import type { Db } from "../types";

/**
 * Migration `0008` against a real (in-process) Postgres (gateway spec §4.2):
 * the two columns, the CHECK, and the hand-appended backfill.
 *
 * The backfill ran when this database was migrated — on an empty table, so it
 * changed nothing. To prove what it does to rows that exist, the test inserts
 * rows the way they looked before `0008` (origin and source_url null) and runs
 * **the UPDATE text read from the migration file itself**, so an edit to the
 * file is what is tested, not a copy of it here.
 */

const RESOURCE_ID = "3f2c9a1e-7b4d-4c8e-9a1f-0d2e3c4b5a69";

function backfillStatement(): string {
  const file = readFileSync(join(migrationsFolder(), "0008_attachment_origin.sql"), "utf8");
  const statements = file
    .split("--> statement-breakpoint")
    .map((part) => part.replace(/^\s*--.*$/gm, "").trim())
    .filter((part) => /^UPDATE\b/i.test(part));
  expect(statements).toHaveLength(1);
  return statements[0];
}

describe("attachments.origin / source_url (migration 0008)", () => {
  let db: Db;

  beforeAll(async () => {
    db = await createPgliteDb();
  });

  function row(overrides: Partial<typeof attachments.$inferInsert> = {}) {
    return {
      blobPathname: `x/${crypto.randomUUID()}.bin`,
      access: "public",
      ...overrides,
    };
  }

  it("accepts every origin in the vocabulary, and null", async () => {
    for (const origin of [...ATTACHMENT_ORIGIN, null]) {
      await db.insert(attachments).values(row({ origin, sourceUrl: origin ? "https://maker.test/x" : null }));
    }
  });

  it("refuses an origin outside the vocabulary", async () => {
    await expectViolation(db.insert(attachments).values(row({ origin: "scraped" })), /attachments_origin_check/);
  });

  it("backfills origin and source_url on an archived manual, and leaves every other row alone", async () => {
    const url = "https://maker.test/manuals/p1s:v2.pdf?lang=en";
    const [manual] = await db
      .insert(attachments)
      .values(row({ contentType: "application/pdf", sourceKey: `manual:${RESOURCE_ID}:${url}` }))
      .returning({ id: attachments.id });
    const [imported] = await db
      .insert(attachments)
      .values(row({ sourceKey: "notion-file-abc:image_attachments:0" }))
      .returning({ id: attachments.id });
    const [uploaded] = await db.insert(attachments).values(row()).returning({ id: attachments.id });
    const [lookalike] = await db
      .insert(attachments)
      .values(row({ sourceKey: "manually-named-key" }))
      .returning({ id: attachments.id });

    await db.execute(sql.raw(backfillStatement()));

    const read = async (id: string) =>
      (
        await db
          .select({ origin: attachments.origin, sourceUrl: attachments.sourceUrl })
          .from(attachments)
          .where(eq(attachments.id, id))
      )[0];

    // The URL survives intact — colons, query string and all.
    expect(await read(manual.id)).toEqual({ origin: "manual_archive", sourceUrl: url });
    expect(await read(imported.id)).toEqual({ origin: null, sourceUrl: null });
    expect(await read(uploaded.id)).toEqual({ origin: null, sourceUrl: null });
    expect(await read(lookalike.id)).toEqual({ origin: null, sourceUrl: null });
  });
});
