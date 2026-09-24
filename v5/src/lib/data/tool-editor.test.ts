// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import { loadToolEditor } from "./tool-editor";

/**
 * The panel's read (spec §5.3(3)).
 *
 * The property under test is what it shows that the catalogue hides: a draft,
 * a retired unit, an unpublished resource. Getting any of those wrong makes the
 * editor unable to fix exactly the rows somebody opened it for.
 */

let db: Db;
let toolId: string;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(units);
  await db.delete(tools);

  const [tool] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4", description: "A resin printer", published: false })
    .returning({ id: tools.id });
  toolId = tool.id;
});

it("finds a draft by slug and mints the token the save will carry", async () => {
  const data = await loadToolEditor("form-4", { db });

  expect(data?.tool.id).toBe(toolId);
  expect(data?.tool.published).toBe(false);
  // Opaque, and a string — never a Date. See `./revision.ts`.
  expect(typeof data?.tool.revision).toBe("string");
});

it("finds the same tool by uuid, which is what the table links with", async () => {
  expect((await loadToolEditor(toolId, { db }))?.tool.slug).toBe("form-4");
});

it("is null for a slug nobody owns, rather than an empty form", async () => {
  expect(await loadToolEditor("no-such-tool", { db })).toBeNull();
});

it("lists every unit including retired ones, which the catalogue hides", async () => {
  await db.insert(units).values([
    { toolId, unitLabel: "Form 4 #2", status: "available" },
    { toolId, unitLabel: "Form 4 #1", status: "retired" },
  ]);

  const data = await loadToolEditor("form-4", { db });

  // Label order: the reviewer reads this list against the machines in the room.
  expect(data?.units.map((unit) => unit.unitLabel)).toEqual(["Form 4 #1", "Form 4 #2"]);
  expect(data?.units[0].status).toBe("retired");
});

it("lists unpublished resources, which are the ones somebody came to look at", async () => {
  await db.insert(resources).values([
    { toolId, title: "Manual", type: "manual", published: true },
    { toolId, title: "Retired SOP", type: "sop", published: false },
  ]);

  const data = await loadToolEditor("form-4", { db });
  expect(data?.resources.map((row) => [row.title, row.published])).toEqual([
    ["Manual", true],
    ["Retired SOP", false],
  ]);
});

it("returns the photos cover first, with the URL the panel renders", async () => {
  await db.insert(attachments).values([
    {
      blobPathname: "uploads/tool/second.jpg",
      access: "public",
      publicUrl: "https://blob.test/second.jpg",
      ownerType: "tool",
      ownerId: toolId,
      position: 1,
    },
    {
      blobPathname: "uploads/tool/cover.jpg",
      access: "public",
      publicUrl: "https://blob.test/cover.jpg",
      ownerType: "tool",
      ownerId: toolId,
      position: 0,
    },
  ]);

  const data = await loadToolEditor("form-4", { db });
  expect(data?.photos.map((photo) => photo.url)).toEqual([
    "https://blob.test/cover.jpg",
    "https://blob.test/second.jpg",
  ]);
});

it("leaves another tool's children alone", async () => {
  const [other] = await db
    .insert(tools)
    .values({ slug: "trotec", name: "Trotec Speedy 400" })
    .returning({ id: tools.id });
  await db.insert(units).values({ toolId: other.id, unitLabel: "Trotec #1" });
  await db.insert(resources).values({ toolId: other.id, title: "Laser manual" });

  const data = await loadToolEditor("form-4", { db });
  expect(data?.units).toEqual([]);
  expect(data?.resources).toEqual([]);
});
