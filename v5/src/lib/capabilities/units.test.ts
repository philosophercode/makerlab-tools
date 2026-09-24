// @vitest-environment node
// `nextCacheMock` is imported first on purpose: `vi.mock` is hoisted above
// every import, and its factory can only reach a module imported before the one
// it replaces.
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { eq } from "drizzle-orm";
import { getDb, resetDbForTests } from "../db/client";
import { maintenanceLogs, units as unitsTable } from "../db/schema/index";
import type { CapabilityCtx, CapabilityTool } from "./types";
import { units } from "./units";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The `units` capability against the demo-seeded PGlite database `getDb()`
 * hands out when `DATABASE_URL` is unset — the substrate the whole suite runs
 * on. The seed's two units are `Form 4 // A` and `Trotec Speedy 400`; the
 * maintenance logs each test needs are written here, since the seed has none.
 */

const ctx: CapabilityCtx = {};

function tool(name: string): CapabilityTool {
  const found = units.tools.find((t) => t.name === name);
  if (!found) throw new Error(`No such tool: ${name}`);
  return found;
}

async function unitId(label: string): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .select({ id: unitsTable.id })
    .from(unitsTable)
    .where(eq(unitsTable.unitLabel, label));
  return row.id;
}

/** Write a log against a seeded unit. Stored values are snake_case (spec §4.1). */
async function logIssue(label: string, values: Partial<typeof maintenanceLogs.$inferInsert>) {
  const db = await getDb();
  await db.insert(maintenanceLogs).values({
    title: "Issue",
    unitId: await unitId(label),
    ...values,
  });
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
});

afterEach(async () => {
  // These tests write; the catalogue rows they read are the seed's and are left
  // alone, so only the logs need clearing between tests.
  const db = await getDb();
  await db.delete(maintenanceLogs);
});

afterAll(() => {
  resetDbForTests();
});

// ── get_unit_details ───────────────────────────────────────────────

describe("get_unit_details", () => {
  it("resolves a seeded unit and derives its status and condition", async () => {
    const result = (await tool("get_unit_details").run(
      { unit_label: "Form 4 // A" },
      ctx
    )) as Record<string, unknown>;

    expect(result).toMatchObject({
      found: true,
      unit_label: "Form 4 // A",
      tool_name: "Form 4",
      tool_slug: "form-4",
      // Stored `in_use` / `excellent`, shown as the display forms the view
      // models have always carried.
      status: "In Use",
      condition: "Excellent",
      serial: "ML-F4-001",
      date_acquired: "2024-08-12",
      detail_page: "/tools/form-4",
      maintenance_logs: [],
    });
    expect(result.unit_id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("matches a unit by a case-insensitive substring of its label", async () => {
    const result = (await tool("get_unit_details").run(
      { unit_label: "trotec" },
      ctx
    )) as Record<string, unknown>;
    expect(result).toMatchObject({ found: true, unit_label: "Trotec Speedy 400" });
  });

  it("returns { found:false } with sample labels for an unknown unit", async () => {
    const result = (await tool("get_unit_details").run(
      { unit_label: "no-such-unit" },
      ctx
    )) as { found: boolean; message: string };

    expect(result.found).toBe(false);
    expect(result.message).toMatch(/Form 4 \/\/ A|Trotec Speedy 400/);
  });

  it("surfaces the unit's maintenance history in display form", async () => {
    await logIssue("Form 4 // A", {
      title: "Resin tank cloudy",
      type: "issue_report",
      priority: "high",
      status: "in_progress",
      description: "The tank film is clouded.",
      dateReported: "2024-09-01",
    });

    const result = (await tool("get_unit_details").run(
      { unit_label: "Form 4 // A" },
      ctx
    )) as { maintenance_logs: Record<string, string>[] };

    expect(result.maintenance_logs).toEqual([
      {
        title: "Resin tank cloudy",
        type: "Issue Report",
        priority: "High",
        status: "In Progress",
        date_reported: "2024-09-01",
        description: "The tank film is clouded.",
      },
    ]);
  });

  it("reads another unit's logs as that unit's, not this one's", async () => {
    await logIssue("Trotec Speedy 400", { title: "Lens dirty" });

    const result = (await tool("get_unit_details").run(
      { unit_label: "Form 4 // A" },
      ctx
    )) as { maintenance_logs: unknown[] };
    expect(result.maintenance_logs).toEqual([]);
  });
});

// ── get_maintenance_history ────────────────────────────────────────

describe("get_maintenance_history", () => {
  it("returns the unit's logs, newest first and capped at 10", async () => {
    for (let i = 0; i < 12; i += 1) {
      await logIssue("Form 4 // A", {
        title: `Issue ${i}`,
        dateReported: `2024-09-${String(i + 1).padStart(2, "0")}`,
      });
    }

    const result = (await tool("get_maintenance_history").run(
      { unit_label: "Form 4 // A" },
      ctx
    )) as { found: boolean; maintenance_logs: { title: string }[] };

    expect(result.found).toBe(true);
    expect(result.maintenance_logs).toHaveLength(10);
    expect(result.maintenance_logs[0].title).toBe("Issue 11");
  });

  it("never puts the reporter's email in front of the model (spec §8)", async () => {
    await logIssue("Form 4 // A", {
      title: "Resin leak",
      reportedByName: "Ada Lovelace",
      reportedByEmail: "ada@cornell.edu",
    });

    const result = await tool("get_maintenance_history").run(
      { unit_label: "Form 4 // A" },
      ctx
    );
    expect(JSON.stringify(result)).not.toContain("cornell.edu");
  });

  it("returns an empty history for a unit with no logs", async () => {
    const result = (await tool("get_maintenance_history").run(
      { unit_label: "Trotec Speedy 400" },
      ctx
    )) as { found: boolean; maintenance_logs: unknown[] };

    expect(result.found).toBe(true);
    expect(result.maintenance_logs).toEqual([]);
  });

  it("returns { found:false } for an unknown unit", async () => {
    const result = (await tool("get_maintenance_history").run(
      { unit_label: "no-such-unit-999" },
      ctx
    )) as { found: boolean; message: string };

    expect(result.found).toBe(false);
    expect(result.message).toMatch(/No unit found matching "no-such-unit-999"/);
  });
});

// ── Prompt fragment ────────────────────────────────────────────────

describe("promptFragment", () => {
  it("still describes both tools, which is what they do", () => {
    const fragment = units.promptFragment?.({ tools: [] }) ?? "";
    expect(fragment).toContain("get_unit_details");
    expect(fragment).toContain("get_maintenance_history");
  });

  // Gateway spec amendment "Chat prompt tuning for Luna": Luna answered a
  // repairs question from `get_unit_details`, whose old example ("show me the
  // history on the Trotec") pointed there.
  it("routes status questions to get_unit_details and repair questions to get_maintenance_history", () => {
    const fragment = units.promptFragment?.({ tools: [] }) ?? "";
    expect(fragment).toMatch(/\*\*Status or condition\*\*[^\n]*call `get_unit_details`/);
    expect(fragment).toMatch(
      /\*\*Repairs, servicing or maintenance history\*\*[^\n]*"show me the history on the Trotec"[^\n]*call `get_maintenance_history`/
    );
  });

  it("answers from the tool, and says so when no repairs are logged", () => {
    const fragment = units.promptFragment?.({ tools: [] }) ?? "";
    expect(fragment).toContain("never from the catalog listing alone");
    expect(fragment).toContain("If the logs are empty, say no repairs or servicing are recorded.");
  });
});
