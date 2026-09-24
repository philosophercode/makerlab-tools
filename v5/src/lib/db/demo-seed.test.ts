// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { scoreConfidence } from "../capabilities/confidence";
import { findDuplicate } from "../data/duplicates";
import { parseResearchResult } from "../research/result";
import {
  DEMO_ACCOUNTS,
  DEMO_FORM_4_NOTION_PAGE_ID,
  DEMO_FORM_4_UNIT_NOTION_PAGE_ID,
  DEMO_PENDING,
  DEMO_PRUSA_RESEARCH,
  DEMO_PROJECT_SLUG,
  DEMO_VINYL_RESEARCH,
  DEMO_WAITING_PROJECT_SLUG,
  seedDemo,
} from "./demo-seed";
import { createPgliteDb } from "./pglite";
import {
  attachments,
  feedback,
  maintenanceLogs,
  pendingTools,
  projectTools,
  projects,
  resources,
  session,
  tools,
  units,
  user,
} from "./schema/index";

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

  it("seeds an account per role, plus one to promote, each with a constant session token", async () => {
    // What makes a role testable without Google: the E2E browser presents a
    // cookie carrying one of these tokens and the server reads the role off
    // the `user` row. `promotable` is the spare the role-change E2E changes,
    // so that test cannot race the ones asserting an ordinary account's
    // controls.
    const db = await createPgliteDb({ seed: seedDemo });

    const users = await db.select().from(user).orderBy(user.email);
    expect(users.map((row) => [row.email, row.role])).toEqual([
      [DEMO_ACCOUNTS.user.email, "user"],
      [DEMO_ACCOUNTS.superAdmin.email, "super_admin"],
      [DEMO_ACCOUNTS.admin.email, "admin"],
      [DEMO_ACCOUNTS.promotable.email, "user"],
    ]);

    const sessions = await db.select().from(session);
    expect(sessions.map((row) => row.token).sort()).toEqual(
      Object.values(DEMO_ACCOUNTS)
        .map((account) => account.sessionToken)
        .sort()
    );
    expect(sessions.every((row) => row.expiresAt.getTime() > Date.now())).toBe(true);
  });

  it("gives each of the three queues one row to show (spec §5.6)", async () => {
    const db = await createPgliteDb({ seed: seedDemo });

    const [ticket] = await db.select().from(maintenanceLogs);
    expect(ticket).toMatchObject({ status: "open", priority: "high", toolName: "Trotec Speedy 400" });
    // It names a real unit, not just the snapshot, so the queue can link to it.
    expect(ticket.unitId).not.toBeNull();

    const [correction] = await db.select().from(feedback);
    expect(correction).toMatchObject({ status: "new", fieldFlagged: "materials" });

    const [waiting] = await db
      .select()
      .from(projects)
      .where(eq(projects.slug, DEMO_WAITING_PROJECT_SLUG));
    // Article 5: it waits for a person, so the gallery cannot see it.
    expect(waiting.published).toBe(false);
    expect(waiting.publishedAt).toBeNull();
  });

  it("leaves three items on the intake page, owned by the admin (spec §5.4)", async () => {
    const db = await createPgliteDb({ seed: seedDemo });

    const rows = await db.select().from(pendingTools);
    expect(Object.fromEntries(rows.map((row) => [row.id, [row.name, row.status]]))).toEqual({
      [DEMO_PENDING.researched.id]: ["Prusa MK4S", "researched"],
      [DEMO_PENDING.lowConfidence.id]: ["Unknown Vinyl Cutter", "researched"],
      [DEMO_PENDING.identified.id]: ["Glowforge Pro", "identified"],
    });
    expect(rows.every((row) => row.createdBy === DEMO_ACCOUNTS.admin.id)).toBe(true);

    const byId = new Map(rows.map((row) => [row.id, row]));
    const prusa = parseResearchResult(byId.get(DEMO_PENDING.researched.id)?.research);
    const vinyl = parseResearchResult(byId.get(DEMO_PENDING.lowConfidence.id)?.research);
    expect(prusa?.confidence.level).toBe("high");
    expect(prusa?.resources.map((resource) => resource.url.startsWith("https://"))).toEqual([true]);
    expect(vinyl?.confidence.level).toBe("low");
    expect(vinyl?.resources).toEqual([]);
    expect(byId.get(DEMO_PENDING.identified.id)?.research).toBeNull();

    // None of them is born a duplicate of a demo tool.
    for (const row of rows) {
      expect(await findDuplicate({ name: row.name, brand: row.brand }, { db, excludePendingIds: rows.map((r) => r.id) })).toBeNull();
    }
  });

  it("grades the seeded research exactly as research would (confidence is computed, never written)", () => {
    expect(DEMO_PRUSA_RESEARCH.confidence).toEqual(scoreConfidence(DEMO_PRUSA_RESEARCH.evidence));
    expect(DEMO_VINYL_RESEARCH.confidence).toEqual(scoreConfidence(DEMO_VINYL_RESEARCH.evidence));
  });

  it("is idempotent", async () => {
    const db = await createPgliteDb({ seed: seedDemo });
    await seedDemo(db);
    const toolRows = await db.select().from(tools);
    expect(toolRows).toHaveLength(2);
  });
});
