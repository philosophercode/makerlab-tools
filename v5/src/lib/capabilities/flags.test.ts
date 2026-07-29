import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { DB_IDS } from "../../../test/msw/handlers";
import { nextCacheMock } from "../../../test/mocks/next-cache";

// `catalog.ts` (pulled in for tool resolution) imports cacheTag/cacheLife.
vi.mock("next/cache", () => nextCacheMock());

import {
  FLAG_FIELDS,
  MAX_FLAG_TEXT,
  buildFlagFields,
  flags,
  hasFlagsEnv,
  parseCorrectionReport,
  submitCorrection,
  type CorrectionReport,
} from "./flags";

const NOTION = "https://api.notion.com/v1";

// The mock catalog is served whenever the Notion catalog env is incomplete; its
// first tool is the Form 4. Stubbing only the two flag vars keeps reads on the
// mock path while the write path is fully configured.
const FORM_4_ID = "tool-form-4";
const FORM_4_NAME = "Form 4";

function stubFlagsEnv() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
  vi.stubEnv("NOTION_DB_FLAGS", DB_IDS.flags);
}

function report(overrides: Partial<CorrectionReport> = {}): CorrectionReport {
  return {
    tool_id: FORM_4_ID,
    field_flagged: "materials",
    issue_description: "Resin list is missing Rigid 10K.",
    ...overrides,
  };
}

/** Capture every POST /pages request body MSW sees. */
function capturePageCreates() {
  const creates: Array<{ parent: { database_id: string }; properties: Record<string, unknown> }> =
    [];
  server.use(
    http.post(`${NOTION}/pages`, async ({ request }) => {
      const body = (await request.json()) as (typeof creates)[number];
      creates.push(body);
      return HttpResponse.json({
        object: "page",
        id: "flag-page-1",
        created_time: "2026-07-29T10:00:00.000Z",
        last_edited_time: "2026-07-29T10:00:00.000Z",
        properties: body.properties,
      });
    })
  );
  return creates;
}

describe("parseCorrectionReport", () => {
  it("accepts a minimal valid report and trims its text", () => {
    const parsed = parseCorrectionReport({
      tool_id: "  tool-form-4  ",
      field_flagged: "description",
      issue_description: "  The bed size is wrong.  ",
    });

    expect(parsed).toEqual({
      ok: true,
      report: {
        tool_id: "tool-form-4",
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

describe("buildFlagFields", () => {
  const tool = { id: FORM_4_ID, name: FORM_4_NAME };

  it("generates the title as '<tool> — <field>' and opens the row as New", () => {
    const fields = buildFlagFields(report({ field_flagged: "safety_info" }), tool);
    expect(fields.title).toBe(`${FORM_4_NAME} — safety_info`);
    expect(fields.status).toBe("New");
    expect(fields.tool).toEqual([FORM_4_ID]);
  });

  it("omits the optional fields when they were not supplied", () => {
    const fields = buildFlagFields(report(), tool);
    expect(fields.suggested_fix).toBeUndefined();
    expect(fields.reporter).toBeUndefined();
    expect(fields.reporter_email).toBeUndefined();
  });

  it("writes reporter_email only for a signed-in reporter", () => {
    const anonymous = buildFlagFields(report(), tool);
    expect(anonymous.reporter_email).toBeUndefined();

    const signedIn = buildFlagFields(report(), tool, {
      name: "Ada",
      email: "ada@example.edu",
    });
    expect(signedIn.reporter_email).toBe("ada@example.edu");
    expect(signedIn.reporter).toBe("Ada");
  });

  it("prefers a self-declared name over the session name", () => {
    const fields = buildFlagFields(report({ reporter: "Grace" }), tool, {
      name: "Ada",
      email: "ada@example.edu",
    });
    expect(fields.reporter).toBe("Grace");
  });
});

describe("hasFlagsEnv", () => {
  it("is false without the flags database configured", () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_FLAGS", "");
    expect(hasFlagsEnv()).toBe(false);
  });

  it("is true once both vars are set", () => {
    stubFlagsEnv();
    expect(hasFlagsEnv()).toBe(true);
  });
});

describe("submitCorrection", () => {
  it("creates one page in the Flags database and never touches Tools", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = await submitCorrection(report({ reporter: "Ada" }));

    expect(result).toEqual({ ok: true, id: "flag-page-1" });
    expect(creates).toHaveLength(1);
    expect(creates[0].parent.database_id).toBe(DB_IDS.flags);
    expect(creates[0].parent.database_id).not.toBe(DB_IDS.tools);
    expect(creates[0].properties).toMatchObject({
      status: { select: { name: "New" } },
      field_flagged: { select: { name: "materials" } },
      tool: { relation: [{ id: FORM_4_ID }] },
    });
  });

  it("resolves the tool by slug as well as by page id", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = await submitCorrection(report({ tool_id: "form-4" }));

    expect(result.ok).toBe(true);
    expect(creates[0].properties.tool).toEqual({ relation: [{ id: FORM_4_ID }] });
  });

  it("returns unknown_tool without writing anything", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = await submitCorrection(report({ tool_id: "no-such-tool" }));

    expect(result).toEqual({ ok: false, code: "unknown_tool" });
    expect(creates).toHaveLength(0);
  });

  it("returns not_configured when the Flags database is unset", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    vi.stubEnv("NOTION_DB_FLAGS", "");
    expect(await submitCorrection(report())).toEqual({
      ok: false,
      code: "not_configured",
    });
  });

  it("swallows the Notion error and reports an opaque write_failure", async () => {
    stubFlagsEnv();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post(`${NOTION}/pages`, () =>
        HttpResponse.json(
          { object: "error", code: "unauthorized", message: "API token is invalid." },
          { status: 401 }
        )
      )
    );

    const result = await submitCorrection(report());

    expect(result).toEqual({ ok: false, code: "write_failed" });
    expect(JSON.stringify(result)).not.toMatch(/token|unauthorized|401/i);
    expect(logged).toHaveBeenCalled();
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

  it("files a correction and returns the flag id", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = (await tool.run(report(), {})) as {
      success: boolean;
      flag_id?: string;
    };

    expect(result.success).toBe(true);
    expect(result.flag_id).toBe("flag-page-1");
    expect(creates[0].parent.database_id).toBe(DB_IDS.flags);
  });

  it("falls back to the tool whose page the student is reading", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = (await tool.run(
      { ...report(), tool_id: "" },
      { focusedToolId: FORM_4_ID }
    )) as { success: boolean };

    expect(result.success).toBe(true);
    expect(creates[0].properties.tool).toEqual({ relation: [{ id: FORM_4_ID }] });
  });

  it("rejects an empty description without calling Notion", async () => {
    stubFlagsEnv();
    const creates = capturePageCreates();

    const result = (await tool.run(
      { ...report(), issue_description: "  " },
      {}
    )) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(creates).toHaveLength(0);
  });

  it("never leaks the Notion error to the model", async () => {
    stubFlagsEnv();
    vi.spyOn(console, "error").mockImplementation(() => {});
    server.use(
      http.post(`${NOTION}/pages`, () =>
        HttpResponse.json({ object: "error", message: "secret detail" }, { status: 500 })
      )
    );

    const result = (await tool.run(report(), {})) as { success: boolean; error?: string };

    expect(result.success).toBe(false);
    expect(result.error).not.toMatch(/secret detail|500/);
  });
});
