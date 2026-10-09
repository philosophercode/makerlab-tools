// @vitest-environment node
import { createPgliteDb } from "../db/pglite";
import { attachments, resources, tools } from "../db/schema/index";
import type { Db } from "../db/types";
import { loadTriageTools } from "./manual-triage-tools";

/**
 * What the Manuals view of `/admin/proposals` shows beside each tool's
 * proposals (amendment 2026-10-07 "manual triage"): name, picture, and every
 * document, hidden ones included. Real (in-process) Postgres.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(attachments);
  await db.delete(tools);
});

describe("loadTriageTools", () => {
  it("reads only the named tools, with their cover picture and every document", async () => {
    const [form, trotec, other] = await db
      .insert(tools)
      .values([
        { slug: "form-4", name: "Form 4", published: true },
        { slug: "trotec", name: "Trotec Speedy 400", published: true },
        { slug: "other", name: "Other", published: true },
      ])
      .returning();
    await db.insert(resources).values([
      { toolId: form.id, title: "Form 4 manual", type: "Manual", url: "https://formlabs.com/form4.pdf", published: true },
      { toolId: form.id, title: "Old brochure", type: "Link", url: "https://formlabs.com/b", published: false },
    ]);
    await db.insert(attachments).values({
      ownerType: "tool",
      ownerId: form.id,
      access: "public",
      publicUrl: "https://blob.example/form-4.jpg",
      blobPathname: "tools/form-4.jpg",
      contentType: "image/jpeg",
      position: 0,
    });

    const loaded = await loadTriageTools([form.id, trotec.id, "not-a-uuid"], { db });
    expect([...loaded.keys()].sort()).toEqual([form.id, trotec.id].sort());
    expect(loaded.has(other.id)).toBe(false);
    expect(loaded.get(form.id)).toMatchObject({ name: "Form 4", slug: "form-4", photo: "https://blob.example/form-4.jpg" });
    expect(loaded.get(form.id)!.documents.map((d) => [d.title, d.published])).toEqual([
      ["Form 4 manual", true],
      ["Old brochure", false],
    ]);
    expect(loaded.get(trotec.id)).toMatchObject({ photo: null, documents: [] });
  });

  it("reads nothing for no tools", async () => {
    expect((await loadTriageTools([], { db })).size).toBe(0);
  });
});
