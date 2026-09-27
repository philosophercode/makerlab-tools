// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
const propose = vi.hoisted(() => ({ proposeAction: vi.fn() }));
vi.mock("../actions/proposals", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../actions/proposals")>()),
  proposeAction: propose.proposeAction,
}));

import type { Identity } from "../auth/identity";
import type { Role } from "../auth/roles";
import { CAPABILITIES, capabilitiesForIdentity } from "./index";
import { actions, actionsPromptFragment } from "./actions";

/**
 * The generated `actions` capability (assistant–GUI parity spec §3.4): each
 * tool proposes and emits a card built from the stored rows; a refusal is a
 * code and a line, never a retry hint; the prompt's rules reach only people
 * offered a tool. The per-role tool counts are the phase 2 measurement §11
 * answer 8 asked for — recorded in the spec's amendment, pinned here so a new
 * action that changes them is a decision, not an accident.
 */

function identity(role: Role): Identity {
  return { role, userId: role === "anonymous" ? null : `u-${role}`, email: null, name: "Dee", rateLimitKey: `k-${role}` };
}

const tool = (name: string) => actions.tools.find((t) => t.name === name)!;

beforeEach(() => propose.proposeAction.mockReset());

describe("a generated tool's run()", () => {
  it("emits a card from the stored rows and tells the model nothing has changed yet", async () => {
    const row = {
      id: "p-1",
      subjectId: "u-luis",
      preview: { summary: { key: "people_set_title", values: { name: "Luis" } }, rows: [], subjectName: "Luis" },
      expiresAt: new Date("2026-09-27T12:00:00Z"),
    };
    propose.proposeAction.mockResolvedValue({ ok: true, groupId: "g-1", proposals: [row], refused: [] });
    const writer = { write: vi.fn() };
    const result = (await tool("set_person_title").run({ user_ids: ["u-luis"], title: "Supermaker" }, {
      identity: identity("super_admin"),
      writer: writer as never,
      chatId: "chat-1",
    })) as Record<string, unknown>;

    expect(propose.proposeAction).toHaveBeenCalledWith(expect.objectContaining({ id: "people.set_title" }), expect.anything(), {
      identity: identity("super_admin"),
      surface: "assistant",
      chatId: "chat-1",
    });
    expect(writer.write).toHaveBeenCalledWith({
      type: "data-action-proposal",
      id: "g-1",
      data: {
        kind: "action-proposal",
        groupId: "g-1",
        actionId: "people.set_title",
        risk: "people",
        items: [{ id: "p-1", subjectId: "u-luis", preview: row.preview, expiresAt: "2026-09-27T12:00:00.000Z" }],
        refused: [],
      },
    });
    expect(result).toMatchObject({ proposed: true, count: 1, subjects: ["Luis"] });
    expect(String(result.message)).toMatch(/NOTHING HAS CHANGED YET/);
  });

  it("answers a refusal as a code and a sentence, and writes no card", async () => {
    propose.proposeAction.mockResolvedValue({ ok: false, error: "last_super_admin" });
    const writer = { write: vi.fn() };
    const result = (await tool("set_person_role").run({ user_id: "u-1", role: "user" }, { identity: identity("super_admin"), writer: writer as never })) as Record<string, unknown>;
    expect(result).toMatchObject({ proposed: false, code: "last_super_admin" });
    expect(String(result.message)).toMatch(/do not retry/);
    expect(writer.write).not.toHaveBeenCalled();
  });

  it("proposes nothing without a signed-in caller", async () => {
    const result = await tool("update_ticket").run({ ticket_ids: ["t"], status: "resolved" }, {});
    expect(result).toMatchObject({ proposed: false, code: "not_signed_in" });
    expect(propose.proposeAction).not.toHaveBeenCalled();
  });
});

describe("who is offered what (the phase 2 measurement, §11 answer 8)", () => {
  const offered = (role: Role) => {
    const caps = capabilitiesForIdentity(CAPABILITIES, identity(role));
    return {
      actionTools: caps.find((c) => c.id === "actions")!.tools.map((t) => t.name),
      chatTools: caps.flatMap((c) => c.tools.filter((t) => !t.mcpOnly)).length,
    };
  };

  it("offers anonymous visitors and students no action tool", () => {
    expect(offered("anonymous").actionTools).toEqual([]);
    expect(offered("user").actionTools).toEqual([]);
  });

  it("offers a SuperMaker the queue actions and no People action", () => {
    expect(offered("admin").actionTools.sort()).toEqual(
      ["log_completed_maintenance", "set_correction_status", "set_project_published", "update_ticket"].sort()
    );
  });

  it("offers a director every generated tool, well under the fold threshold of 30", () => {
    expect(offered("super_admin").actionTools).toHaveLength(10);
    expect(offered("super_admin").chatTools).toBe(26);
    expect(offered("admin").chatTools).toBe(19);
    expect(offered("user").chatTools).toBe(9);
  });
});

describe("actionsPromptFragment", () => {
  it.each(["anonymous", "user"] as const)("says nothing to %s", (role) => {
    expect(actionsPromptFragment({ tools: [], identity: identity(role) })).toBe("");
  });

  it("gives the rules to somebody offered a tool, naming only their tools", () => {
    const staff = actionsPromptFragment({ tools: [], identity: identity("admin") });
    expect(staff).toMatch(/The Confirm button is the only way to commit/);
    expect(staff).toMatch(/Never say it was done/);
    expect(staff).toContain("`update_ticket`");
    expect(staff).not.toContain("`set_person_role`");
    expect(actionsPromptFragment({ tools: [], identity: identity("super_admin") })).toContain("`set_person_role`");
  });
});
