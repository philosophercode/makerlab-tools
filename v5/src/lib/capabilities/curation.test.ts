// @vitest-environment node
import { eq } from "drizzle-orm";
import { recordTurnHost, recordTurnText, turnHosts } from "../chat/turn-sources";
import { getDb, resetDbForTests } from "../db/client";
import { chatProposals, tools } from "../db/schema/index";
import { capabilitiesForIdentity } from "./access";
import { CHAT_PROPOSAL_FIELDS, cleanValue, CURATION_TOOLS, curationCapability } from "./curation";
import type { CapabilityCtx, CurationContext } from "./types";

/**
 * The `curation` capability (refresh research spec §12.1, §12.5 "Unit"):
 * `propose_change` validates each field and refuses PPE, checks quotes against
 * this turn's pages only, and is never composed without the permission.
 */

const [getRecord, proposeChange] = CURATION_TOOLS;
let toolId: string;
let curation: CurationContext;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  const db = await getDb();
  const [tool] = await db.select().from(tools).where(eq(tools.slug, "form-4"));
  toolId = tool.id;
  curation = { kind: "tool", id: toolId, name: "Form 4", revision: "1", fields: {}, sources: ["https://formlabs.example/form4"] };
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(chatProposals);
  resetDbForTests();
});

function ctx(overrides: Partial<CapabilityCtx> = {}): CapabilityCtx {
  return { curation, writer: { write: vi.fn(), merge: vi.fn(), onError: undefined } as unknown as CapabilityCtx["writer"], ...overrides };
}

describe("propose_change", () => {
  it("refuses PPE, whatever it is called", async () => {
    for (const field of ["ppe_required", "PPE", "protective_equipment"]) {
      expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field, value: ["Gloves"] }, ctx())).toMatchObject({
        status: "refused",
        code: "ppe_not_proposed",
      });
    }
  });

  it("refuses a field it does not know, and the cover photo", async () => {
    expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "cover_photo", value: "x" }, ctx())).toMatchObject({
      code: "unknown_field",
    });
    expect(CHAT_PROPOSAL_FIELDS).not.toContain("cover_photo");
  });

  it("validates the value per field", () => {
    expect(cleanValue("name", "  Formlabs Form 4 ")).toBe("Formlabs Form 4");
    expect(cleanValue("name", "")).toBeUndefined();
    // The display rules (tool display names spec §5.5): no part number, not over the cap.
    expect(cleanValue("name", "Makita 196094-2 Plunge Base")).toBeUndefined();
    expect(cleanValue("name", "x".repeat(41))).toBeUndefined();
    expect(cleanValue("name", "Bambu Lab X2D")).toBe("Bambu Lab X2D");
    expect(cleanValue("official_name", "  Makita 196094-2 Compact Router Plunge Base ")).toBe("Makita 196094-2 Compact Router Plunge Base");
    expect(cleanValue("official_name", "x".repeat(201))).toBeUndefined();
    expect(CHAT_PROPOSAL_FIELDS).toContain("official_name");
    expect(cleanValue("materials", ["Resin", " Tough "])).toEqual(["Resin", "Tough"]);
    expect(cleanValue("materials", ["Resin", 4])).toBeUndefined();
    expect(cleanValue("tags", "Resin")).toBeUndefined();
    expect(cleanValue("training_required", "yes")).toBeUndefined();
    expect(cleanValue("training_required", true)).toBe(true);
    expect(cleanValue("resource", { title: "Manual", url: "javascript:alert(1)" })).toBeUndefined();
    expect(cleanValue("resource", { title: "Manual", url: "https://formlabs.example/m.pdf", type: "Brochure" })).toEqual({
      title: "Manual",
      url: "https://formlabs.example/m.pdf",
      type: "Other",
    });
    expect(cleanValue("description", "x".repeat(4001))).toBeUndefined();
  });

  it("proposes only for the record this page shows", async () => {
    expect(
      await proposeChange.run({ subject: { kind: "tool", id: "00000000-0000-4000-8000-000000000000" }, field: "name", value: "X" }, ctx())
    ).toMatchObject({ code: "not_this_record" });
    expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "name", value: "X" }, { })).toMatchObject({
      code: "not_this_record",
    });
  });

  it("checks quotes against this turn's pages only, stores the proposal, and emits a card", async () => {
    const turn = ctx();
    recordTurnText(turn, "https://formlabs.example/form4", "Form 4\nThe Form 4 prints at up to 100 mm per hour.");
    const result = await proposeChange.run(
      {
        subject: { kind: "tool", id: toolId },
        field: "description",
        value: "An MSLA resin printer that prints at up to 100 mm per hour.",
        citations: [
          { quote: "prints at up to 100 mm per hour", url: "https://formlabs.example/form4" },
          { quote: "prints at up to 100 mm per hour", url: "https://unread.example/form4" },
        ],
      },
      turn
    );
    expect(result).toMatchObject({ status: "proposed", verified: [true, false] });
    const db = await getDb();
    const [row] = await db.select().from(chatProposals);
    expect(row.proposal).toMatchObject({ field: "description", kind: expect.stringMatching(/new|differs/), decision: "pending" });
    expect(turn.writer?.write).toHaveBeenCalledWith(expect.objectContaining({ type: "data-proposal" }));
    // Another turn's pages do not count.
    const other = ctx();
    const again = await proposeChange.run(
      {
        subject: { kind: "tool", id: toolId },
        field: "use_restrictions",
        value: "Trained users only.",
        citations: [{ quote: "prints at up to 100 mm per hour", url: "https://formlabs.example/form4" }],
      },
      other
    );
    expect(again).toMatchObject({ status: "proposed", verified: [false] });
  });

  it("proposes nothing when the value matches the record", async () => {
    const db = await getDb();
    const [tool] = await db.select().from(tools).where(eq(tools.id, toolId));
    expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "name", value: tool.name.toUpperCase() }, ctx())).toMatchObject({
      code: "matches",
    });
  });

  it("refuses another tool's display name, whatever its case (display names amendment 2026-09-25)", async () => {
    expect(
      await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "name", value: "trotec speedy 400" }, ctx())
    ).toMatchObject({ status: "refused", code: "duplicate_name" });
    const db = await getDb();
    expect(await db.select().from(chatProposals)).toEqual([]);
  });

  describe("research never replaces lab rules (amendment 2026-09-24)", () => {
    it("Form 4: a replacement restriction becomes an added line; the lab's resin rule is kept", async () => {
      const result = await proposeChange.run(
        { subject: { kind: "tool", id: toolId }, field: "use_restrictions", value: "Young or inexperienced users must be supervised." },
        ctx()
      );
      expect(result).toMatchObject({ status: "proposed", lab_rules_kept: true, added: ["Young or inexperienced users must be supervised."] });
      const db = await getDb();
      const [row] = await db.select().from(chatProposals);
      expect(row.proposal).toMatchObject({
        field: "use_restrictions",
        kind: "differs",
        current: "Resin handling training required before first print.",
        proposed: "Resin handling training required before first print.\nYoung or inexperienced users must be supervised.",
        added: ["Young or inexperienced users must be supervised."],
      });
    });

    it("refuses restrictions that only remove or reword the lab's", async () => {
      expect(
        await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "use_restrictions", value: "resin handling training required before first print" }, ctx())
      ).toMatchObject({ status: "refused", code: "lab_rule_kept" });
      const db = await getDb();
      expect(await db.select().from(chatProposals)).toHaveLength(0);
    });

    it("refuses turning the lab's training requirement off, but not on", async () => {
      expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "training_required", value: false }, ctx())).toMatchObject({
        status: "refused",
        code: "lab_rule_kept",
      });
      const db = await getDb();
      await db.update(tools).set({ trainingRequired: false }).where(eq(tools.id, toolId));
      expect(await proposeChange.run({ subject: { kind: "tool", id: toolId }, field: "training_required", value: true }, ctx())).toMatchObject({
        status: "proposed",
      });
    });

    it("a pending item's values are research's drafts: training may be proposed off there", async () => {
      const pendingId = "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a01";
      const pending: CurationContext = { ...curation, kind: "pending", id: pendingId };
      expect(
        await proposeChange.run({ subject: { kind: "pending", id: pendingId }, field: "training_required", value: false }, ctx({ curation: pending }))
      ).toMatchObject({ status: "proposed" });
    });

    it("tells the model the lab's rules stay, on a tool only", () => {
      const tool = curationCapability("tool").promptFragment({ tools: [], curation });
      expect(tool).toMatch(/The lab's rules stay/);
      const pending = curationCapability("pending").promptFragment({ tools: [], curation: { ...curation, kind: "pending" } });
      expect(pending).not.toMatch(/The lab's rules stay/);
    });
  });

  it("refuses a floor check on a pending item", async () => {
    const pending: CurationContext = { ...curation, kind: "pending", id: "11111111-1111-4111-8111-111111111111" };
    expect(
      await proposeChange.run({ subject: { kind: "pending", id: pending.id }, field: "floor_check", value: "Read the plate." }, ctx({ curation: pending }))
    ).toMatchObject({ code: "unknown_field" });
  });
});

describe("get_record", () => {
  it("returns the record's values, revision and sources — only for this page's record", async () => {
    const result = await getRecord.run({ subject: { kind: "tool", id: toolId } }, ctx());
    expect(result).toMatchObject({ status: "ok", fields: expect.objectContaining({ name: "Form 4" }), revision: expect.any(String) });
    expect(await getRecord.run({ subject: { kind: "pending", id: toolId } }, ctx())).toMatchObject({ code: "not_this_record" });
  });
});

describe("composition", () => {
  it("is not composed without the permission: tools.edit for a tool, tools.approve for a pending item", () => {
    const [studentTool] = capabilitiesForIdentity([curationCapability("tool")], { role: "user" });
    expect(studentTool.tools).toEqual([]);
    const [anonymousPending] = capabilitiesForIdentity([curationCapability("pending")], { role: null });
    expect(anonymousPending.tools).toEqual([]);
    const [adminTool] = capabilitiesForIdentity([curationCapability("tool")], { role: "admin" });
    expect(adminTool.tools.map((tool) => tool.name)).toEqual(["get_record", "propose_change"]);
    expect(curationCapability("pending").requiredPermission).toBe("tools.approve");
  });

  it("is chat-only, and its prompt is empty without a record", () => {
    for (const tool of CURATION_TOOLS) expect(tool.chatOnly).toBe(true);
    expect(curationCapability("tool").promptFragment({ tools: [] })).toBe("");
  });
});

describe("turn sources", () => {
  it("records hosts a turn's searches returned", () => {
    const turn = {};
    recordTurnHost(turn, "https://www.formlabs.com/form-4");
    recordTurnHost(turn, "not a url");
    expect(turnHosts(turn)).toEqual(["www.formlabs.com"]);
  });
});
