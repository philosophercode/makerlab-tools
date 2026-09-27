// @vitest-environment node
// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above
// every import, and its factory can only reach a module imported before the one
// it replaces.
import { nextCacheMock } from "../../test/mocks/next-cache";
import { cacheLife, cacheTag } from "next/cache";
import { CATALOG_CACHE } from "./cache";
import { getCatalogStats, getCatalogTool, getCatalogTools, isDemoCatalog } from "./catalog";
import { getDb, resetDbForTests } from "./db/client";
import { tools } from "./db/schema/index";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The catalogue against the demo-seeded PGlite database `getDb()` hands out
 * when `DATABASE_URL` is unset — the same substrate the test suite, E2E and a
 * fresh clone run on. The seed is two tools, so these assertions are about the
 * wiring and the derivation, not about the lab's real inventory.
 */

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

// One in-process database for the file: nothing here writes, so there is
// nothing to isolate between tests, and a fresh PGlite per test would pay for
// the migrations every time.
afterAll(() => {
  resetDbForTests();
});

// ── getCatalogTools ─────────────────────────────────────────────────

describe("getCatalogTools", () => {
  it("returns the seeded catalogue ordered by name", async () => {
    const catalog = await getCatalogTools();
    expect(catalog.map((tool) => tool.slug)).toEqual(["form-4", "trotec-speedy-400"]);
  });

  it("resolves a tool's category, location and map tag through the joins", async () => {
    const [form4] = await getCatalogTools();
    expect(form4).toMatchObject({
      name: "Form 4",
      category: "3D Printing",
      categorySub: "Resin",
      location: "MakerLab",
      zone: "Resin Bench",
      mapId: "ML-RESIN-01",
    });
    expect(form4.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("derives status from the units' stored snake_case values", async () => {
    const [form4, trotec] = await getCatalogTools();
    // The Form 4's one unit is `in_use`; the Trotec's is `available`, so its
    // status falls through to the tool's training gate.
    expect(form4.status).toBe("In Use");
    expect(form4.units[0]).toMatchObject({
      name: "Form 4 // A",
      serial: "ML-F4-001",
      status: "In Use",
      condition: "Excellent",
      location: "Resin Bench",
      dateAcquired: "2024-08-12",
    });
    expect(trotec.status).toBe("Training Required");
    expect(trotec.units[0]).toMatchObject({ status: "Available", condition: "Good" });
  });

  it("derives the training level from the restrictions and tags", async () => {
    const [form4, trotec] = await getCatalogTools();
    expect(form4.trainingLevel).toBe("Intermediate");
    expect(form4.trainingLabel).toBe("Resin handling training required before first print.");
    // "Authorized" is one of the Trotec's tags.
    expect(trotec.trainingLevel).toBe("Advanced");
  });

  it("falls back to the bundled photo when no attachment carries one", async () => {
    const [form4, trotec] = await getCatalogTools();
    expect(form4.imageSrc).toBe("/tool-images/Form%204.png");
    // The Trotec's bundled image does not match its name, so the seed gives it
    // an attachment and the catalogue uses that URL as-is.
    expect(trotec.imageSrc).toBe("/tool-images/Trotec Speedy 400, 80w.png");
  });

  it("attaches each tool's resource links", async () => {
    const [form4] = await getCatalogTools();
    expect(form4.links.map((link) => link.label)).toEqual([
      "Form 4 SOP",
      "Resin handling safety",
    ]);
    expect(form4.links[0].kind).toBe("SOP");
  });

  it("leaves a draft or archived tool out of the catalogue", async () => {
    const db = await getDb();
    await db
      .insert(tools)
      .values([
        { slug: "draft-tool", name: "Draft tool", published: false },
        { slug: "archived-tool", name: "Archived tool", published: true, archivedAt: new Date() },
      ])
      .onConflictDoNothing();

    const slugs = (await getCatalogTools()).map((tool) => tool.slug);
    expect(slugs).not.toContain("draft-tool");
    expect(slugs).not.toContain("archived-tool");
  });
});

// ── getCatalogTool ──────────────────────────────────────────────────

describe("getCatalogTool", () => {
  it("resolves a slug", async () => {
    const tool = await getCatalogTool("trotec-speedy-400");
    expect(tool?.name).toBe("Trotec Speedy 400");
  });

  it("resolves the Postgres uuid capabilities pass back as tool.id", async () => {
    const [form4] = await getCatalogTools();
    const tool = await getCatalogTool(form4.id);
    expect(tool?.slug).toBe("form-4");
  });

  it("returns null for an unknown slug or uuid", async () => {
    expect(await getCatalogTool("nope")).toBeNull();
    expect(await getCatalogTool("11111111-2222-3333-4444-555555555555")).toBeNull();
  });
});

// ── getCatalogStats ─────────────────────────────────────────────────

describe("getCatalogStats", () => {
  it("counts the published tools and reports lab hours", async () => {
    const stats = await getCatalogStats();
    expect(stats.toolsInInventory).toBe(2);
    expect(stats.labHours).toBe("LAB OPEN 9AM-9PM");
  });
});

// ── Caching and the substrate ───────────────────────────────────────

describe("caching", () => {
  it("tags every read `catalog` and gives it the long catalogue lifetime", async () => {
    vi.mocked(cacheTag).mockClear();
    vi.mocked(cacheLife).mockClear();

    await getCatalogTools();
    await getCatalogTool("form-4");
    await getCatalogStats();

    expect(vi.mocked(cacheTag).mock.calls).toEqual([["catalog"], ["catalog"], ["catalog"]]);
    expect(vi.mocked(cacheLife)).toHaveBeenCalledWith(CATALOG_CACHE);
  });
});

describe("isDemoCatalog", () => {
  it("is true on the PGlite demo seed and false once a database is configured", () => {
    expect(isDemoCatalog()).toBe(true);
    vi.stubEnv("DATABASE_URL", "postgres://user:pass@example.neon.tech/db");
    expect(isDemoCatalog()).toBe(false);
  });
});

// ── Failing toward stale, never toward invented data ────────────────

describe("a database failure", () => {
  afterEach(() => {
    vi.doUnmock("./data/catalog");
    vi.resetModules();
  });

  // Article 4: the old code caught a Notion failure and served the mock
  // catalogue, so a broken deploy looked healthy and showed equipment the lab
  // does not own. The error has to reach the page instead.
  it("propagates instead of falling back to sample data", async () => {
    vi.resetModules();
    vi.doMock("./data/catalog", () => ({
      listCatalogTools: () => Promise.reject(new Error("the database is unavailable")),
      findToolByIdOrSlug: () => Promise.reject(new Error("the database is unavailable")),
      countPublishedTools: () => Promise.reject(new Error("the database is unavailable")),
    }));
    const catalog = await import("./catalog");

    await expect(catalog.getCatalogTools()).rejects.toThrow("the database is unavailable");
    await expect(catalog.getCatalogTool("form-4")).rejects.toThrow("the database is unavailable");
    await expect(catalog.getCatalogStats()).rejects.toThrow("the database is unavailable");
  });
});
