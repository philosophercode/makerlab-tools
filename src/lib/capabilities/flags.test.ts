// @vitest-environment node
import { eq } from "drizzle-orm";
import { nextCacheMock } from "../../../test/mocks/next-cache";

// `catalog.ts` (pulled in for tool resolution) imports cacheTag/cacheLife.
vi.mock("next/cache", () => nextCacheMock());

import { getCatalogTools } from "../catalog";
import { getDb, resetDbForTests } from "../db/client";
import { feedback, tools as toolsTable } from "../db/schema/index";
import { seedUser } from "../../../test/utils/session";
import {
  FLAG_FIELDS,
  MAX_FLAG_TEXT,
  buildFeedbackRow,
  flags,
  parseCorrectionReport,
  submitCorrection,
  type CorrectionReport,
} from "./flags";

/**
 * Corrections, end to end against the demo-seeded PGlite database with **no
 * environment variables at all** — no Notion env, no MSW, no network. The
 * whole path is real code from the validation down to the row (Article 3).
 */

const FORM_4_NAME = "Form 4";
let FORM_4_ID = "";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const catalogue = await getCatalogTools();
  FORM_4_ID = catalogue.find((tool) => tool.slug === "form-4")?.id ?? "";
  const db = await getDb();
  await db.delete(feedback);
});

afterAll(() => {
  resetDbForTests();
});

/** The Form 4 as `buildFeedbackRow` receives it. */
function flaggedTool() {
  return { id: FORM_4_ID, name: FORM_4_NAME };
}

function report(overrides: Partial<CorrectionReport> = {}): CorrectionReport {
  return {
    tool_id: FORM_4_ID,
    field_flagged: "materials",
    issue_description: "Resin list is missing Rigid 10K.",
    ...overrides,
  };
}

/** Every correction currently in the table. */
async function storedRows() {
  const db = await getDb();
  return db.select().from(feedback);
}

describe("parseCorrectionReport", () => {
  it("accepts a minimal valid report and trims its text", () => {
    const parsed = parseCorrectionReport({
      tool_id: "  form-4  ",
      field_flagged: "description",
      issue_description: "  The bed size is wrong.  ",
    });

    expect(parsed).toEqual({
      ok: true,
      report: {
        tool_id: "form-4",
        field_flagged: "description",
        issue_description: "The bed size is wrong.",
        suggested_fix: undefined,
        reporter: undefined,
      },
    });
  });

  it("rejects an invalid field_flagged", () => {
    const parsed = parseCorrectionReport({
      tool_id: FORM_4_ID,
      field_flagged: "price",
      issue_description: "Too expensive.",
    });
    expect(parsed).toEqual({ ok: false, code: "invalid_input" });
  });

  it("accepts every documented field_flagged option", () => {
    for (const field of FLAG_FIELDS) {
      const parsed = parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: field,
        issue_description: "Wrong.",
      });
      expect(parsed.ok, field).toBe(true);
    }
  });

  it("rejects an empty description", () => {
    expect(
      parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: "description",
        issue_description: "",
      })
    ).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects a whitespace-only description", () => {
    expect(
      parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: "description",
        issue_description: "   \n  ",
      })
    ).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects a missing tool_id", () => {
    expect(
      parseCorrectionReport({
        tool_id: "",
        field_flagged: "description",
        issue_description: "Wrong.",
      })
    ).toEqual({ ok: false, code: "invalid_input" });
  });

  it("enforces the 2,000-character cap on description and suggested fix", () => {
    const atCap = "x".repeat(MAX_FLAG_TEXT);
    const overCap = "x".repeat(MAX_FLAG_TEXT + 1);

    expect(
      parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: "description",
        issue_description: atCap,
      }).ok
    ).toBe(true);

    expect(
      parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: "description",
        issue_description: overCap,
      })
    ).toEqual({ ok: false, code: "invalid_input" });

    expect(
      parseCorrectionReport({
        tool_id: FORM_4_ID,
        field_flagged: "description",
        issue_description: "Wrong.",
        suggested_fix: overCap,
      })
    ).toEqual({ ok: false, code: "invalid_input" });
  });

  it("rejects a non-object payload", () => {
    expect(parseCorrectionReport(null)).toEqual({ ok: false, code: "invalid_input" });
    expect(parseCorrectionReport("nope")).toEqual({ ok: false, code: "invalid_input" });
  });
});

describe("buildFeedbackRow", () => {
  it("maps every field onto its column and opens the row as new", () => {
    const row = buildFeedbackRow(
      report({ field_flagged: "safety_info", suggested_fix: "Add the PPE line." }),
      flaggedTool()
    );

    expect(row).toEqual({
      // The catalogue uuid, which is what `tool_id` takes — there is no page
      // id in this path any more.
      toolId: FORM_4_ID,
      fieldFlagged: "safety_info",
      issueDescription: "Resin list is missing Rigid 10K.",
      suggestedFix: "Add the PPE line.",
      reporterName: null,
      reporterEmail: null,
      reporterUserId: null,
    });
  });

  it("nulls the optional fields when they were not supplied", () => {
    const row = buildFeedbackRow(report(), flaggedTool());
    expect(row.suggestedFix).toBeNull();
    expect(row.reporterName).toBeNull();
    expect(row.reporterEmail).toBeNull();
  });

  it("writes reporter_email and reporter_user_id only for a signed-in reporter", () => {
    expect(buildFeedbackRow(report(), flaggedTool()).reporterEmail).toBeNull();

    const signedIn = buildFeedbackRow(report(), flaggedTool(), {
      name: "Ada",
      email: "ada@example.edu",
      userId: "google-sub-1",
    });
    expect(signedIn.reporterEmail).toBe("ada@example.edu");
    expect(signedIn.reporterUserId).toBe("google-sub-1");
    expect(signedIn.reporterName).toBe("Ada");
  });

  it("prefers a self-declared name over the session name", () => {
    const row = buildFeedbackRow(report({ reporter: "Grace" }), flaggedTool(), {
      name: "Ada",
      email: "ada@example.edu",
    });
    expect(row.reporterName).toBe("Grace");
  });
});

describe("submitCorrection", () => {
  it("inserts one `new` row against the tool and touches nothing else", async () => {
    const db = await getDb();
    const toolsBefore = await db.select().from(toolsTable);

    const result = await submitCorrection(report({ reporter: "Ada" }));

    expect(result.ok).toBe(true);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      toolId: FORM_4_ID,
      fieldFlagged: "materials",
      status: "new",
      reporterName: "Ada",
    });
    // The assertion that matters (spec §8): a flag is inert. The catalogue is
    // byte-for-byte what it was.
    expect(await db.select().from(toolsTable)).toEqual(toolsBefore);
  });

  it("returns the id of the row it actually wrote", async () => {
    const result = await submitCorrection(report());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const db = await getDb();
    const [row] = await db.select().from(feedback).where(eq(feedback.id, result.id));
    expect(row).toBeDefined();
  });

  it("resolves the tool by slug as well as by catalogue id", async () => {
    const result = await submitCorrection(report({ tool_id: "form-4" }));

    expect(result.ok).toBe(true);
    expect((await storedRows())[0].toolId).toBe(FORM_4_ID);
  });

  it("returns unknown_tool without writing anything", async () => {
    const result = await submitCorrection(report({ tool_id: "no-such-tool" }));

    expect(result).toEqual({ ok: false, code: "unknown_tool" });
    expect(await storedRows()).toHaveLength(0);
  });

  it("swallows the database error and reports an opaque write_failed", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    // A `feedback` row with a description longer than the column's own CHECK
    // would be caught by validation, so the failure is staged at the driver:
    // a configured database nobody can reach.
    const toolId = FORM_4_ID;
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
    resetDbForTests();

    const result = await submitCorrection(report({ tool_id: toolId }));

    expect(result).toEqual({ ok: false, code: "write_failed" });
    expect(JSON.stringify(result)).not.toMatch(/hunter2|postgres|ECONNREFUSED/i);
    expect(logged).toHaveBeenCalled();

    // Put the demo substrate back before the file's own cleanup runs: the
    // stub is still in force until vitest's global afterEach clears it.
    vi.stubEnv("DATABASE_URL", "");
    resetDbForTests();
  });
});

describe("report_correction capability tool", () => {
  const tool = flags.tools[0];

  it("is registered as a write tool", () => {
    expect(flags.id).toBe("flags");
    expect(tool.name).toBe("report_correction");
    expect(tool.kind).toBe("write");
    expect(tool.chatOnly).toBeUndefined();
  });

  it("files a correction and returns the row id", async () => {
    const result = (await tool.run(report(), {})) as {
      success: boolean;
      flag_id?: string;
    };

    expect(result.success).toBe(true);
    const rows = await storedRows();
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe(result.flag_id);
  });

  it("falls back to the tool whose page the student is reading", async () => {
    const result = (await tool.run(
      { ...report(), tool_id: "" },
      { focusedToolId: FORM_4_ID }
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect((await storedRows())[0].toolId).toBe(FORM_4_ID);
  });

  it("records the chat caller's session, the same way report_issue does", async () => {
    // `created_by` references `user.id` since Phase 4; the reporter is a row.
    await seedUser({ id: "google-sub-1", email: "ada@cornell.edu" });
    await tool.run(report(), {
      identity: {
        role: "user",
        userId: "google-sub-1",
        email: "ada@cornell.edu",
        name: "Ada Lovelace",
        rateLimitKey: "user:google-sub-1",
      },
    });

    expect((await storedRows())[0]).toMatchObject({
      reporterEmail: "ada@cornell.edu",
      reporterUserId: "google-sub-1",
      reporterName: "Ada Lovelace",
    });
  });

  it("treats an anonymous identity as nobody at all", async () => {
    await tool.run(report(), {
      identity: {
        role: "anonymous",
        userId: null,
        email: null,
        name: null,
        rateLimitKey: "ip:deadbeef",
      },
    });

    const [row] = await storedRows();
    expect(row.reporterEmail).toBeNull();
    expect(row.reporterUserId).toBeNull();
  });

  it("rejects an empty description without writing", async () => {
    const result = (await tool.run({ ...report(), issue_description: "  " }, {})) as {
      success: boolean;
      error?: string;
    };

    expect(result.success).toBe(false);
    expect(await storedRows()).toHaveLength(0);
  });

  it("never leaks the database error to the model", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
    resetDbForTests();

    const result = (await tool.run(report(), {})) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/hunter2|postgres|ECONNREFUSED/i);

    vi.stubEnv("DATABASE_URL", "");
    resetDbForTests();
  });
});

describe("flags prompt fragment", () => {
  it("no longer tells the assistant that staff read corrections in Notion", () => {
    expect(flags.promptFragment({ tools: [] })).not.toMatch(/notion/i);
  });
});
