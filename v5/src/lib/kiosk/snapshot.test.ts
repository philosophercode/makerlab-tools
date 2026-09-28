// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { KIOSK_CACHE } from "../cache";
import { createPgliteDb } from "../db/pglite";
import { resetDbForTests } from "../db/client";
import { maintenanceLogs, projectTools, projects, tools, units } from "../db/schema/index";
import type { Db } from "../db/types";
import { insertUserRow } from "../../../test/utils/session";
import { assembleKioskSnapshot, isProductImage, loadKioskSnapshot, withAskUrl } from "./snapshot";

/**
 * The kiosk loader against a real (in-process) Postgres (kiosk spec §10):
 * what reads as down, the ticket figure, what is featured — and the privacy
 * case, the test that would embarrass us.
 */

const NOW = new Date("2026-10-11T15:00:00Z");

/** One published tool named after a bundled photo, one without a photo, and a draft. */
async function seedLab(db: Db) {
  const [dremel, mystery, draft, archived] = await db
    .insert(tools)
    .values([
      { slug: "dremel-3000", name: "Dremel 3000", published: true, description: "A rotary tool for sanding, cutting and engraving." },
      { slug: "mystery-press", name: "Mystery Press", published: true, description: "No photo yet." },
      { slug: "secret-prototype", name: "Secret Prototype", published: false, description: "Not ready." },
      { slug: "old-lathe", name: "Old Lathe", published: true, archivedAt: new Date("2026-01-01T00:00:00Z") },
    ])
    .returning({ id: tools.id });

  await db.insert(units).values([
    { toolId: dremel.id, unitLabel: "Dremel // A", status: "available" },
    { toolId: dremel.id, unitLabel: "Dremel // B", status: "under_maintenance" },
    { toolId: dremel.id, unitLabel: "Dremel // C", status: "retired" },
    { toolId: mystery.id, unitLabel: "Mystery Press", status: "in_use" },
    { toolId: draft.id, unitLabel: "Secret Prototype", status: "out_of_service" },
    { toolId: archived.id, unitLabel: "Old Lathe", status: "out_of_service" },
  ]);

  return { dremel, mystery, draft, archived };
}

describe("assembleKioskSnapshot", () => {
  let db: Db;

  beforeEach(async () => {
    db = await createPgliteDb();
  });

  it("lists a published tool with a unit down as '1 of 2', and nothing else", async () => {
    await seedLab(db);
    const snapshot = await assembleKioskSnapshot({ db, now: NOW });

    expect(snapshot.down).toEqual([
      expect.objectContaining({ toolSlug: "dremel-3000", toolName: "Dremel 3000", unitsDown: 1, unitsTotal: 2, state: "under_maintenance" }),
    ]);
    // Dremel's two in service and the Mystery Press's one; the draft and the
    // archived tool's units are not the catalogue's.
    expect(snapshot.unitsInService).toBe(3);
    expect(snapshot.generatedAt).toBe(NOW.toISOString());
    expect(snapshot.lab).toEqual({ hoursText: "LAB OPEN 9AM-9PM", openNow: null, closesAt: null });
  });

  it("counts open and in-progress tickets, and nothing settled", async () => {
    await seedLab(db);
    await db.insert(maintenanceLogs).values([
      { title: "a", status: "open" },
      { title: "b", status: "open" },
      { title: "c", status: "in_progress" },
      { title: "d", status: "resolved" },
      { title: "e", status: "closed" },
    ]);
    const snapshot = await assembleKioskSnapshot({ db, now: NOW });
    expect(snapshot.tickets).toEqual({ open: 2, inProgress: 1 });
  });

  it("reads zero tickets as zero — a count that came back zero", async () => {
    const snapshot = await assembleKioskSnapshot({ db, now: NOW });
    expect(snapshot.tickets).toEqual({ open: 0, inProgress: 0 });
    expect(snapshot.down).toEqual([]);
  });

  it("features published tools with a real photo and published projects, with the author shortened", async () => {
    const { dremel, draft } = await seedLab(db);
    const [lamp, hidden] = await db
      .insert(projects)
      .values([
        { slug: "lamp", title: "Laser-cut lamp", authorName: "Maya Rodriguez", published: true },
        { slug: "dice", title: "Resin dice tower", authorName: "Casey Rivera", published: false },
      ])
      .returning({ id: projects.id });
    await db.insert(projectTools).values([
      { projectId: lamp.id, toolId: dremel.id },
      { projectId: lamp.id, toolId: draft.id },
      { projectId: hidden.id, toolId: dremel.id },
    ]);

    const { featured } = await assembleKioskSnapshot({ db, now: NOW });
    const bySlug = Object.fromEntries(featured.map((item) => [item.slug, item]));

    expect(Object.keys(bySlug).sort()).toEqual(["dremel-3000", "lamp"]);
    expect(bySlug["dremel-3000"]).toEqual({
      kind: "tool",
      slug: "dremel-3000",
      name: "Dremel 3000",
      shortDescription: "A rotary tool for sanding, cutting and engraving.",
      imageSrc: "/tool-images/Dremel%203000.png",
    });
    // The draft tool is not named among what the lamp was built with.
    expect(bySlug.lamp).toEqual({ kind: "project", slug: "lamp", title: "Laser-cut lamp", coverSrc: "", toolNames: ["Dremel 3000"], author: "Maya R." });
  });

  it("shows no author for a project with no byline", async () => {
    await db.insert(projects).values({ slug: "anon", title: "Anonymous thing", published: true });
    const { featured } = await assembleKioskSnapshot({ db, now: NOW });
    expect(featured).toEqual([expect.objectContaining({ slug: "anon", author: null })]);
  });

  it("says the ticket count is unavailable — null, never 0 — when it cannot be read, and still answers the rest", async () => {
    await seedLab(db);
    await db.execute(sql`drop table maintenance_logs cascade`);
    vi.spyOn(console, "error").mockImplementation(() => {});

    const snapshot = await assembleKioskSnapshot({ db, now: NOW });

    expect(snapshot.tickets).toBeNull();
    expect(snapshot.down).toHaveLength(1);
  });

  it("throws when the catalogue cannot be read, so the caller says 'unavailable' instead of 'all running'", async () => {
    await db.execute(sql`drop table units cascade`);
    await expect(assembleKioskSnapshot({ db, now: NOW })).rejects.toThrow();
  });

  /**
   * The privacy case (§10). A ticket whose text names a student and carries
   * their address, a person with a title, a draft tool, an unpublished
   * project — none of it may reach a public screen, not even as a key name.
   */
  it("carries no name, address, ticket text or draft in the serialised payload", async () => {
    await seedLab(db);
    await insertUserRow(db, { name: "Casey Rivera", email: "casey@cornell.edu" });
    await db.execute(sql`update "user" set title = 'Tech Lead' where email = 'casey@cornell.edu'`);
    await db.insert(maintenanceLogs).values({
      title: "Casey's printer jam",
      description: "Casey (casey@cornell.edu) jammed it",
      status: "open",
      reportedByName: "Casey Rivera",
      reportedByEmail: "casey@cornell.edu",
    });
    await db.insert(projects).values([
      { slug: "dice", title: "Resin dice tower", authorName: "Casey Rivera", published: false },
      { slug: "lamp", title: "Laser-cut lamp", authorName: "Maya Rodriguez", published: true },
    ]);

    const payload = JSON.stringify(withAskUrl(await assembleKioskSnapshot({ db, now: NOW }), "https://makerlab-ai.vercel.app"));

    expect(payload).not.toContain("@");
    expect(payload.toLowerCase()).not.toContain("casey");
    expect(payload.toLowerCase()).not.toContain("reported");
    expect(payload).not.toContain('"description"');
    expect(payload).not.toContain("jammed");
    expect(payload).not.toContain("Tech Lead");
    expect(payload).not.toContain("Secret Prototype");
    expect(payload).not.toContain("Resin dice tower");
    expect(payload).not.toContain("Rodriguez");
    // …and it still says what it should.
    expect(payload).toContain("Maya R.");
    expect(JSON.parse(payload).tickets).toEqual({ open: 1, inProgress: 0 });
  });
});

describe("loadKioskSnapshot", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("PGLITE_DATA_DIR", "");
  });
  afterEach(() => {
    resetDbForTests();
    vi.unstubAllEnvs();
  });

  it("is cached under every tag whose writes change the screen, on the kiosk's lifetime", async () => {
    vi.mocked(cacheTag).mockClear();
    vi.mocked(cacheLife).mockClear();
    await loadKioskSnapshot();
    expect(vi.mocked(cacheTag)).toHaveBeenCalledWith("catalog", "projects", "maintenance");
    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith(KIOSK_CACHE);
  });

  it("reads the demo seed as demo data, with its one open ticket", async () => {
    const snapshot = await loadKioskSnapshot();
    expect(snapshot.demo).toBe(true);
    expect(snapshot.tickets).toEqual({ open: 1, inProgress: 0 });
    expect(snapshot.down).toEqual([]);
  });
});

describe("isProductImage", () => {
  it.each([
    ["https://abc.public.blob.vercel-storage.com/tools/x.png", true],
    ["/api/dev-blob/tools/x.png", true],
    ["/tool-images/Dremel%203000.png", true],
    ["/tool-images/Mystery%20Press.png", false],
    ["/tool-images/%E0%A4%A.png", false],
    ["", false],
  ])("%s → %s", (src, expected) => {
    expect(isProductImage(src)).toBe(expected);
  });
});
