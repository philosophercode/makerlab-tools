// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  notionPageIdForTool,
  notionPageIdForUnit,
  notionPageIdsForTools,
} from "./notion-ids";
import { isUuid } from "./uuid";

/**
 * The Postgres → Notion page id translation the three remaining Notion writes
 * depend on, against a real (in-process) Postgres with rows this file inserts.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(tools);
});

/** One tool, with or without the page id the import would have recorded. */
async function insertTool(slug: string, notionPageId: string | null): Promise<string> {
  const [row] = await db
    .insert(tools)
    .values({ slug, name: slug, notionPageId })
    .returning({ id: tools.id });
  return row.id;
}

async function insertUnit(toolId: string, notionPageId: string | null): Promise<string> {
  const [row] = await db
    .insert(units)
    .values({ toolId, unitLabel: `${toolId} // A`, status: "available", notionPageId })
    .returning({ id: units.id });
  return row.id;
}

// ── isUuid ──────────────────────────────────────────────────────────

describe("isUuid", () => {
  it("accepts a uuid in either case and rejects everything else", () => {
    expect(isUuid("1f2e3d4c-5b6a-4789-8abc-def012345678")).toBe(true);
    expect(isUuid("1F2E3D4C-5B6A-4789-8ABC-DEF012345678")).toBe(true);
    expect(isUuid("form-4")).toBe(false);
    expect(isUuid("Form 4 // A")).toBe(false);
    expect(isUuid("1f2e3d4c5b6a47898abcdef012345678")).toBe(false);
    expect(isUuid("")).toBe(false);
  });
});

// ── Tools ───────────────────────────────────────────────────────────

describe("notionPageIdForTool", () => {
  it("returns the page the tool was imported from", async () => {
    const id = await insertTool("form-4", "notion-tool-1");
    await expect(notionPageIdForTool(id, { db })).resolves.toBe("notion-tool-1");
  });

  it("is null for a tool that never came from Notion", async () => {
    const id = await insertTool("locally-made", null);
    await expect(notionPageIdForTool(id, { db })).resolves.toBeNull();
  });

  it("is null for an unknown uuid", async () => {
    await expect(notionPageIdForTool(crypto.randomUUID(), { db })).resolves.toBeNull();
  });

  it("is null for a slug or free text, without a bad-cast error", async () => {
    // A surface may hand this a slug; reaching a uuid column with one throws.
    await expect(notionPageIdForTool("form-4", { db })).resolves.toBeNull();
    await expect(notionPageIdForTool("", { db })).resolves.toBeNull();
  });
});

// ── Units ───────────────────────────────────────────────────────────

describe("notionPageIdForUnit", () => {
  it("returns the page the unit was imported from", async () => {
    const toolId = await insertTool("form-4", "notion-tool-1");
    const unitId = await insertUnit(toolId, "notion-unit-1");

    await expect(notionPageIdForUnit(unitId, { db })).resolves.toBe("notion-unit-1");
  });

  it("is null for a unit with no page, so the ticket is filed unlinked", async () => {
    const toolId = await insertTool("form-4", "notion-tool-1");
    const unitId = await insertUnit(toolId, null);

    await expect(notionPageIdForUnit(unitId, { db })).resolves.toBeNull();
  });

  it("is null for a unit label that failed to resolve", async () => {
    await expect(notionPageIdForUnit("Form 4 // A", { db })).resolves.toBeNull();
  });
});

// ── Many tools ──────────────────────────────────────────────────────

describe("notionPageIdsForTools", () => {
  it("translates each id, in the order it was given", async () => {
    const first = await insertTool("form-4", "notion-tool-1");
    const second = await insertTool("trotec", "notion-tool-2");

    await expect(notionPageIdsForTools([second, first], { db })).resolves.toEqual([
      "notion-tool-2",
      "notion-tool-1",
    ]);
  });

  it("drops ids that do not resolve rather than passing them through", async () => {
    // One unresolvable relation id fails the whole Notion page, which would
    // lose the student's submission (Article 4).
    const known = await insertTool("form-4", "notion-tool-1");
    const local = await insertTool("locally-made", null);

    await expect(
      notionPageIdsForTools([known, local, crypto.randomUUID(), "form-4"], { db })
    ).resolves.toEqual(["notion-tool-1"]);
  });

  it("is empty for an empty list and for a list with no uuids, without querying", async () => {
    await expect(notionPageIdsForTools([], { db })).resolves.toEqual([]);
    await expect(notionPageIdsForTools(["form-4", "trotec"], { db })).resolves.toEqual([]);
  });

  it("keeps a repeated id as often as it was given", async () => {
    const id = await insertTool("form-4", "notion-tool-1");

    await expect(notionPageIdsForTools([id, id], { db })).resolves.toEqual([
      "notion-tool-1",
      "notion-tool-1",
    ]);
  });
});
