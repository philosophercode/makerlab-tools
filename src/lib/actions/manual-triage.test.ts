import type { ActionProposalRecord } from "../data/action-proposals";
import { buildManualTriage, safeUrl, triageToolIds, type TriageSourceTool } from "./manual-triage";

/**
 * The Manuals view's data (amendment 2026-10-07 "manual triage"): open
 * resource proposals grouped by tool, each described before → after from its
 * stored input and preview, with a label for what it does.
 */

let clock = 0;
function row(over: Partial<ActionProposalRecord> & Pick<ActionProposalRecord, "actionId" | "input">): ActionProposalRecord {
  clock += 1;
  return {
    id: over.id ?? `p${clock}`,
    groupId: over.groupId ?? `g${clock}`,
    subjectType: "tool",
    subjectId: "x",
    preview: { summary: { key: "resources_add", values: { tool: "Form 4", title: "x" } }, rows: [] },
    surface: "mcp",
    chatId: null,
    status: "open",
    result: null,
    tainted: false,
    createdBy: "u1",
    decidedBy: null,
    decidedAt: null,
    expiresAt: new Date("2099-01-01T00:00:00Z"),
    createdAt: new Date(Date.UTC(2026, 9, 6, 12, 0, clock)),
    expired: false,
    ...over,
  };
}

const FORM: TriageSourceTool = {
  name: "Form 4",
  slug: "form-4",
  photo: "/thumbs/form-4-160.webp",
  documents: [
    {
      id: "r1",
      title: "form4 manual",
      type: "Link",
      url: "https://formlabs.com/form4.pdf",
      published: true,
      fileUrls: [],
      archivedUrl: "https://blob.example/manuals/form4.pdf",
      manual: { pageCount: 212 },
    },
    { id: "r2", title: "Safety", type: "SOP", url: null, published: false, fileUrls: [] },
  ],
};

const edit = (resourceId: string, patch: Record<string, unknown>, rows: { field: string; before: string | null; after: string | null }[]) =>
  row({
    actionId: "resources.edit",
    input: { toolId: "t-form", expectedRevision: "1", resourceId, patch },
    preview: { summary: { key: "resources_edit", values: { tool: "Form 4", title: "form4 manual" } }, rows },
  });

describe("buildManualTriage", () => {
  it("groups by tool, names each change, and keeps proposal order inside a tool", () => {
    const rows = [
      row({
        actionId: "resources.add",
        input: { toolId: "t-trotec", expectedRevision: "1", resource: { title: "Speedy 400 manual", url: "https://www.trotec.com/s400.pdf", type: "Manual", published: true } },
        preview: { summary: { key: "resources_add", values: { tool: "Speedy 400", title: "Speedy 400 manual" } }, rows: [] },
      }),
      row({ actionId: "resources.add", input: { toolId: "t-form", expectedRevision: "1", resource: { title: "Formlabs page", url: "https://formlabs.com/form-4/", type: "Link", published: true } } }),
      edit("r1", { url: "https://formlabs.com/form-4-manual.pdf" }, [{ field: "url", before: "https://formlabs.com/form4.pdf", after: "https://formlabs.com/form-4-manual.pdf" }]),
      edit("r1", { type: "Manual", title: "Form 4 manual" }, [
        { field: "resourceTitle", before: "form4 manual", after: "Form 4 manual" },
        { field: "resourceType", before: "Link", after: "Manual" },
      ]),
      edit("r2", { published: true }, [{ field: "catalogue", before: "unpublished", after: "published" }]),
      edit("r1", { published: false }, [{ field: "catalogue", before: "published", after: "unpublished" }]),
      edit("r1", { type: "Link" }, [{ field: "resourceType", before: "Link", after: "Link" }]),
    ];
    const view = buildManualTriage(rows, new Map([["t-form", FORM]]));

    expect(view.proposalCount).toBe(7);
    // By name; a tool not loaded (deleted since) keeps the name its proposal stored, with no link.
    expect(view.tools.map((tool) => [tool.name, tool.link, tool.photo])).toEqual([
      ["Form 4", "/tools/form-4", "/thumbs/form-4-160.webp"],
      ["Speedy 400", null, null],
    ]);
    const [form, trotec] = view.tools;
    expect(form.documents).toEqual([
      { id: "r1", title: "form4 manual", type: "Link", url: "https://formlabs.com/form4.pdf", host: "formlabs.com", hidden: false, pages: 212 },
      { id: "r2", title: "Safety", type: "SOP", url: null, host: null, hidden: true, pages: null },
    ]);
    expect(form.proposals.map((p) => p.changes)).toEqual([["add_link"], ["replace_link"], ["retype", "retitle"], ["show"], ["hide"], ["rearchive"]]);
    expect(trotec.proposals[0]).toMatchObject({
      changes: ["add_manual"],
      before: null,
      after: { title: "Speedy 400 manual", type: "Manual", url: "https://www.trotec.com/s400.pdf", hidden: false },
      host: "trotec.com",
      openUrl: "https://www.trotec.com/s400.pdf",
      openIsPdf: true,
      pages: null,
    });
  });

  it("shows an edit as the whole document before and after, with what changed", () => {
    const view = buildManualTriage(
      [
        edit("r1", { type: "Manual", title: "Form 4 manual" }, [
          { field: "resourceTitle", before: "form4 manual", after: "Form 4 manual" },
          { field: "resourceType", before: "Link", after: "Manual" },
        ]),
      ],
      new Map([["t-form", FORM]])
    );
    expect(view.tools[0].proposals[0]).toMatchObject({
      before: { title: "form4 manual", type: "Link", url: "https://formlabs.com/form4.pdf", hidden: false },
      after: { title: "Form 4 manual", type: "Manual", url: "https://formlabs.com/form4.pdf", hidden: false },
      changed: ["title", "type"],
      stale: [],
      missing: false,
      // The link is unchanged: Open PDF opens it, and the stored copy's page count applies.
      openUrl: "https://formlabs.com/form4.pdf",
      openIsPdf: true,
      pages: 212,
    });
  });

  it("drops the stored page count when the link is replaced", () => {
    const view = buildManualTriage(
      [edit("r1", { url: "https://formlabs.com/new" }, [{ field: "url", before: "https://formlabs.com/form4.pdf", after: "https://formlabs.com/new" }])],
      new Map([["t-form", FORM]])
    );
    expect(view.tools[0].proposals[0]).toMatchObject({ openUrl: "https://formlabs.com/new", openIsPdf: false, pages: null, host: "formlabs.com" });
  });

  it("marks a change whose shown value moved since it was proposed, and one whose document is gone", () => {
    const view = buildManualTriage(
      [
        edit("r1", { title: "Form 4 manual" }, [{ field: "resourceTitle", before: "Old title", after: "Form 4 manual" }]),
        edit("gone", { title: "Anything" }, [{ field: "resourceTitle", before: "Lost", after: "Anything" }]),
      ],
      new Map([["t-form", FORM]])
    );
    expect(view.tools[0].proposals.map((p) => [p.stale, p.missing])).toEqual([
      [["title"], false],
      [[], true],
    ]);
  });

  it("never offers a link that is not http(s)", () => {
    const view = buildManualTriage(
      [row({ actionId: "resources.add", input: { toolId: "t-form", expectedRevision: "1", resource: { title: "Bad", url: "javascript:alert(1)" } } })],
      new Map([["t-form", FORM]])
    );
    expect(view.tools[0].proposals[0]).toMatchObject({ openUrl: null, host: null, changes: ["add_link"] });
  });

  it("leaves out decided, expired and other proposals", () => {
    const view = buildManualTriage(
      [
        row({ actionId: "resources.add", input: { toolId: "t-form", expectedRevision: "1", resource: { title: "a" } }, status: "cancelled" }),
        row({ actionId: "resources.add", input: { toolId: "t-form", expectedRevision: "1", resource: { title: "b" } }, expired: true }),
        row({ actionId: "tools.mark_reviewed", input: { toolId: "t-form", expectedRevision: "1" } }),
      ],
      new Map([["t-form", FORM]])
    );
    expect(view).toEqual({ tools: [], proposalCount: 0 });
  });
});

describe("safeUrl", () => {
  it("keeps http(s) links only", () => {
    expect(safeUrl("https://formlabs.com/a.pdf")).toBe("https://formlabs.com/a.pdf");
    expect(safeUrl("javascript:alert(1)")).toBeNull();
    expect(safeUrl("not a url")).toBeNull();
    expect(safeUrl(null)).toBeNull();
  });
});

describe("triageToolIds", () => {
  it("names each tool with an open, unexpired resource proposal once", () => {
    const rows = [
      row({ actionId: "resources.add", input: { toolId: "t1", expectedRevision: "1", resource: { title: "a" } } }),
      row({ actionId: "resources.edit", input: { toolId: "t1", expectedRevision: "1", resourceId: "r", patch: {} } }),
      row({ actionId: "resources.add", input: { toolId: "t2", expectedRevision: "1", resource: { title: "b" } }, status: "confirmed" }),
      row({ actionId: "resources.add", input: { toolId: "t3", expectedRevision: "1", resource: { title: "c" } }, expired: true }),
      row({ actionId: "tools.mark_reviewed", input: { toolId: "t4", expectedRevision: "1" } }),
    ];
    expect(triageToolIds(rows)).toEqual(["t1"]);
  });
});
