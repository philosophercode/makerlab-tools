// @vitest-environment node
import { seedManual, seedTool } from "../../../test/manuals/seed";
import { createPgliteDb } from "../db/pglite";
import type { Db } from "../db/types";
import { toolIdsForDocuments } from "./targets";

/**
 * Which machines the archive run's skill tail refreshes (tool skills spec
 * 2026-10-07 §5.4): each built document's tool, once, in order, archived
 * tools left out.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

it("answers each document's tool once, in the order given, leaving archived tools out", async () => {
  const form = await seedTool(db, { name: "Form 4", slug: "form-4-targets" });
  const laser = await seedTool(db, { name: "Laser", slug: "laser-targets" });
  const old = await seedTool(db, { name: "Old", slug: "old-targets", archived: true });
  const a = await seedManual(db, { toolId: form, title: "A", pages: ["a"] });
  const b = await seedManual(db, { toolId: form, title: "B", pages: ["b"] });
  const c = await seedManual(db, { toolId: laser, title: "C", pages: ["c"] });
  const d = await seedManual(db, { toolId: old, title: "D", pages: ["d"] });

  expect(await toolIdsForDocuments(db, [c.documentId, a.documentId, b.documentId, d.documentId])).toEqual([laser, form]);
  expect(await toolIdsForDocuments(db, [])).toEqual([]);
  expect(await toolIdsForDocuments(db, ["not-a-uuid"])).toEqual([]);
});
