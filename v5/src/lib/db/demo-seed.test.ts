// @vitest-environment node
import { and, eq } from "drizzle-orm";
import {
  DEMO_FORM_4_NOTION_PAGE_ID,
  DEMO_FORM_4_UNIT_NOTION_PAGE_ID,
  DEMO_PROJECT_SLUG,
  seedDemo,
} from "./demo-seed";
import { createPgliteDb } from "./pglite";
import { attachments, projectTools, projects, resources, tools, units } from "./schema/index";

describe("seedDemo", () => {
  it("inserts the two demo tools with their units and resources", async () => {
    const db = await createPgliteDb({ seed: seedDemo });

    const toolRows = await db.select().from(tools).orderBy(tools.slug);
    expect(toolRows.map((row) => row.name)).toEqual(["Form 4", "Trotec Speedy 400"]);
    expect(toolRows.every((row) => row.published)).toBe(true);

    const form4 = toolRows[0];
    // Legacy-QR redirect fixture (spec Goal 2): Form 4 carries a Notion page
    // id so an old `/tools/<id>` link can be tested end to end.
    expect(form4.notionPageId).toBe(DEMO_FORM_4_NOTION_PAGE_ID);
    expect(toolRows[1].notionPageId).toBeNull();

    const form4Units = await db.select().from(units).where(eq(units.toolId, form4.id));
    expect(form4Units).toHaveLength(1);
    expect(form4Units[0]).toMatchObject({ unitLabel: "Form 4 // A", status: "in_use", condition: "excellent" });
    // The unit carries a page id too: the writes still on Notion relate rows by
    // page id, and the Trotec's unit deliberately has none so both branches of
    // that translation are reachable from the seed.
    expect(form4Units[0].notionPageId).toBe(DEMO_FORM_4_UNIT_NOTION_PAGE_ID);

    const trotecUnits = await db
      .select()
      .from(units)
      .where(eq(units.toolId, toolRows[1].id));
    expect(trotecUnits[0].notionPageId).toBeNull();

    const form4Resources = await db.select().from(resources).where(eq(resources.toolId, form4.id));
    expect(form4Resources.map((row) => row.title)).toEqual(["Form 4 SOP", "Resin handling safety"]);
  });

  it("gives the Trotec a photo attachment, since its bundled image does not match its name", async () => {
    const db = await createPgliteDb({ seed: seedDemo });
    const [trotec] = await db.select().from(tools).where(eq(tools.slug, "trotec-speedy-400"));
    const photos = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.ownerType, "tool"), eq(attachments.ownerId, trotec.id)));
    expect(photos).toHaveLength(1);
    expect(photos[0]).toMatchObject({ access: "public", publicUrl: "/tool-images/Trotec Speedy 400, 80w.png" });
  });

  it("publishes one sample project with photos, materials, a link, and both tools", async () => {
    const db = await createPgliteDb({ seed: seedDemo });

    const [lamp] = await db.select().from(projects).where(eq(projects.slug, DEMO_PROJECT_SLUG));
    expect(lamp).toMatchObject({
      title: "Laser-cut plywood lamp",
      published: true,
      link: "https://en.wikipedia.org/wiki/Laser_cutting",
      authorName: "MakerLab demo",
    });
    expect(lamp.materials.length).toBeGreaterThanOrEqual(3);
    expect(lamp.body).toContain("## How it went");

    const links = await db.select().from(projectTools).where(eq(projectTools.projectId, lamp.id));
    expect(links).toHaveLength(2);

    const photos = await db
      .select()
      .from(attachments)
      .where(and(eq(attachments.ownerType, "project"), eq(attachments.ownerId, lamp.id)))
      .orderBy(attachments.position);
    expect(photos.map((p) => p.publicUrl)).toEqual([
      "/sample-projects/laser-cut-lamp-lit.png",
      "/sample-projects/laser-cut-lamp-parts.png",
    ]);
    expect(photos.every((p) => p.access === "public")).toBe(true);
  });

  it("is idempotent", async () => {
    const db = await createPgliteDb({ seed: seedDemo });
    await seedDemo(db);
    const toolRows = await db.select().from(tools);
    expect(toolRows).toHaveLength(2);
  });
});
