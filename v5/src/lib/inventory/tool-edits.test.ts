// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { sql } from "drizzle-orm";
import { revalidateTag } from "next/cache";

import { readToolRevision } from "../data/tools";
import { createPgliteDb } from "../db/pglite";
import { tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { saveToolFields } from "./tool-edits";

/**
 * Saving the editor's fields: what the data layer does, plus the one thing it
 * cannot do — telling the catalogue (spec §3.9).
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  vi.mocked(revalidateTag).mockClear();
  await db.delete(tools);
  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", description: "before" })
    .returning({ id: tools.id });
  toolId = row.id;
});

async function revision(): Promise<string> {
  return (await readToolRevision(toolId, { db }))!;
}

it("writes the patch and drops the catalogue cache", async () => {
  const result = await saveToolFields({
    toolId,
    patch: { description: "after" },
    expectedRevision: await revision(),
    db,
  });

  expect(result).toEqual({ ok: true, revision: expect.any(String) });
  const [row] = await db.select().from(tools);
  expect(row.description).toBe("after");
  expect(revalidateTag).toHaveBeenCalledWith("catalog", { expire: 0 });
});

it("refuses a stale token, writes nothing, and busts no cache", async () => {
  const stale = await revision();
  // Staged: PGlite's clock is millisecond-resolution, so a second write in the
  // same millisecond would share a token.
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set description = 'somebody else', updated_at = updated_at + interval '1 second'`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);

  const result = await saveToolFields({
    toolId,
    patch: { description: "mine" },
    expectedRevision: stale,
    db,
  });

  expect(result).toEqual({ ok: false, error: "conflict" });
  // Their value survives — a conflict is never a silent overwrite.
  expect((await db.select().from(tools))[0].description).toBe("somebody else");
  expect(revalidateTag).not.toHaveBeenCalled();
});

it("refuses a field the catalogue could not use", async () => {
  const result = await saveToolFields({
    toolId,
    patch: { name: "  " },
    expectedRevision: await revision(),
    db,
  });

  expect(result).toEqual({ ok: false, error: "invalid_field" });
  expect((await db.select().from(tools))[0].name).toBe("Form 4");
});
