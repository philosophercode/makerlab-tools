// @vitest-environment node
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "../db/client";
import { maintenanceLogs, units as unitsTable } from "../db/schema/index";
import type { MakerLabTool } from "../../components/catalog-types";
import {
  buildUnitLookup,
  findTool,
  findUnit,
  recentMaintenance,
  summarizeTool,
} from "./helpers";

/**
 * The shared capability helpers: the pure lookups on fixtures, and
 * `recentMaintenance` against the demo-seeded PGlite database `getDb()` hands
 * out when `DATABASE_URL` is unset.
 */

// ── Fixtures ────────────────────────────────────────────────────────

function makeTool(overrides: Partial<MakerLabTool> = {}): MakerLabTool {
  return {
    id: "2a6f0d1e-0000-4000-8000-000000000001",
    slug: "form-4",
    name: "Form 4",
    category: "3D Printing",
    categorySub: "Resin",
    location: "MakerLab",
    zone: "Resin Bench",
    trainingLevel: "Intermediate",
    trainingLabel: "Resin handling training required.",
    status: "In Use",
    shortDescription: "A resin printer.",
    description: "A production-grade resin printer.",
    imageSrc: "/tool-images/Form%204.png",
    ppe: ["Nitrile gloves"],
    materials: ["Standard resin"],
    tags: ["Resin"],
    emergencyStop: null,
    useRestrictions: null,
    mapId: null,
    notes: null,
    links: [],
    units: [
      {
        id: "3b7f0d1e-0000-4000-8000-000000000001",
        name: "Form 4 // A",
        serial: "ML-F4-001",
        status: "In Use",
        condition: "Excellent",
        location: "Resin Bench",
        dateAcquired: "2024-08-12",
      },
    ],
    ...overrides,
  };
}

const trotec = makeTool({
  id: "2a6f0d1e-0000-4000-8000-000000000002",
  slug: "trotec-speedy-400",
  name: "Trotec Speedy 400",
  category: "Laser",
  categorySub: "CO2",
  location: "Laser Room",
  zone: "Laser Bay",
  status: "Available",
  units: [
    {
      id: "3b7f0d1e-0000-4000-8000-000000000002",
      name: "Trotec Speedy 400",
      serial: "ML-LSR-400",
      status: "Available",
      condition: "Good",
      location: "Laser Bay",
      dateAcquired: "2022-04-03",
    },
  ],
});

const catalog = [makeTool(), trotec];

// ── Unit lookup ─────────────────────────────────────────────────────

describe("buildUnitLookup", () => {
  it("flattens every tool's units, carrying the tool they belong to", () => {
    const lookup = buildUnitLookup(catalog);
    expect(lookup).toHaveLength(2);
    expect(lookup[0]).toMatchObject({
      label: "Form 4 // A",
      toolName: "Form 4",
      toolSlug: "form-4",
      status: "In Use",
      condition: "Excellent",
      serial: "ML-F4-001",
    });
  });

  it("is empty for a catalogue whose tools have no units", () => {
    expect(buildUnitLookup([makeTool({ units: [] })])).toEqual([]);
  });
});

describe("findUnit", () => {
  const lookup = buildUnitLookup(catalog);

  it("prefers an exact, case-insensitive label match", () => {
    expect(findUnit(lookup, "form 4 // a")?.label).toBe("Form 4 // A");
  });

  it("falls back to the first substring match", () => {
    expect(findUnit(lookup, "trotec")?.label).toBe("Trotec Speedy 400");
  });

  it("returns null for an unknown or empty label", () => {
    expect(findUnit(lookup, "no-such-unit")).toBeNull();
    expect(findUnit(lookup, "   ")).toBeNull();
  });
});

// ── Tool lookup / summaries ─────────────────────────────────────────

describe("findTool", () => {
  it("resolves by id, by slug, by exact name, then by partial name", () => {
    expect(findTool(catalog, catalog[0].id)?.slug).toBe("form-4");
    expect(findTool(catalog, "trotec-speedy-400")?.name).toBe("Trotec Speedy 400");
    expect(findTool(catalog, "form 4")?.slug).toBe("form-4");
    expect(findTool(catalog, "speedy")?.slug).toBe("trotec-speedy-400");
  });

  it("returns null for an unknown or empty needle", () => {
    expect(findTool(catalog, "no-such-tool")).toBeNull();
    expect(findTool(catalog, "")).toBeNull();
  });
});

describe("summarizeTool", () => {
  it("packs the fields a list result needs onto one line", () => {
    expect(summarizeTool(catalog[0])).toBe(
      `Form 4 | id: ${catalog[0].id} | 3D Printing > Resin | MakerLab / Resin Bench | training: Intermediate | status: In Use`
    );
  });
});

// ── recentMaintenance (Postgres) ────────────────────────────────────

describe("recentMaintenance", () => {
  beforeEach(() => {
    vi.stubEnv("DATABASE_URL", "");
  });

  afterEach(async () => {
    const db = await getDb();
    await db.delete(maintenanceLogs);
  });

  afterAll(() => {
    resetDbForTests();
  });

  async function seededUnitId(label: string): Promise<string> {
    const db = await getDb();
    const [row] = await db
      .select({ id: unitsTable.id })
      .from(unitsTable)
      .where(eq(unitsTable.unitLabel, label));
    return row.id;
  }

  it("flattens logs to the shape both chat and MCP have always returned", async () => {
    const id = await seededUnitId("Form 4 // A");
    const db = await getDb();
    await db.insert(maintenanceLogs).values({
      title: "Resin tank cloudy",
      unitId: id,
      type: "issue_report",
      priority: "high",
      status: "open",
      description: "The tank film is clouded.",
      resolution: "Not yet.",
      dateReported: "2024-09-01",
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
    });

    const [entry] = await recentMaintenance(id);

    // Exactly six keys — the tool descriptions and prompt fragments say the
    // model gets type, priority, status, date and description, and nothing in
    // the richer query module leaks past this boundary.
    expect(entry).toEqual({
      title: "Resin tank cloudy",
      type: "Issue Report",
      priority: "High",
      status: "Open",
      date_reported: "2024-09-01",
      description: "The tank film is clouded.",
    });
  });

  it("caps at the 10 most recent", async () => {
    const id = await seededUnitId("Form 4 // A");
    const db = await getDb();
    await db.insert(maintenanceLogs).values(
      Array.from({ length: 12 }, (_, i) => ({
        title: `Issue ${i}`,
        unitId: id,
        dateReported: `2024-09-${String(i + 1).padStart(2, "0")}`,
      }))
    );

    const entries = await recentMaintenance(id);
    expect(entries).toHaveLength(10);
    expect(entries[0].title).toBe("Issue 11");
  });

  it("resolves to [] for a unit with no history", async () => {
    expect(await recentMaintenance(await seededUnitId("Trotec Speedy 400"))).toEqual([]);
  });

  it("resolves to [] and logs rather than failing the tool call when the read throws", async () => {
    // Replace the query module for this test only, so an unreachable database
    // is simulated without one going near the network (Article 3).
    vi.resetModules();
    vi.doMock("../data/maintenance", () => ({
      listMaintenanceHistoryForUnit: vi.fn(async () => {
        throw new Error("The database is unavailable.");
      }),
    }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { recentMaintenance: withFailingDb } = await import("./helpers");
    // The tool still answers, and the failure is visible in the logs rather
    // than swallowed silently (Article 4).
    expect(await withFailingDb("3b7f0d1e-0000-4000-8000-000000000001")).toEqual([]);
    expect(warn).toHaveBeenCalled();

    vi.doUnmock("../data/maintenance");
    vi.resetModules();
  });
});
