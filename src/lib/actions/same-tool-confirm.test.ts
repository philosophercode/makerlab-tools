// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

import { asc, eq } from "drizzle-orm";
import { saveTool } from "../../app/admin/inventory/actions";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { readToolRevision } from "../data/tools";
import { getDb, resetDbForTests } from "../db/client";
import { actionProposals, auditEvents, resources, session, tools, user } from "../db/schema/index";
import { signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * Several proposals for one tool, confirmed in one step (amendment 2026-10-07
 * "manual triage"). Each stores the tool's revision when it was proposed;
 * confirming one moves it. In one request they now confirm in order, and each
 * write still checks the revision in the database, so someone else's save in
 * between is still a `conflict`. Real PGlite and sessions; the mirror and the
 * manual archive are stubbed.
 */

let db: Awaited<ReturnType<typeof getDb>>;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "same-tool-confirm-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  db = await getDb();
  await db.delete(actionProposals);
  await db.delete(auditEvents);
  await db.delete(resources);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function staff(): Promise<Identity> {
  const signedIn = await signInAsNew({ email: "sam@cornell.edu", role: "admin", name: "Sam" });
  setMockHeaders({ cookie: signedIn.cookie });
  return resolveIdentityFromHeaders();
}

/** A tool with one existing document, as the AI found it. */
async function toolWithManual() {
  const [tool] = await db.insert(tools).values({ slug: "form-4", name: "Form 4", published: true }).returning();
  const [doc] = await db
    .insert(resources)
    .values({ toolId: tool.id, title: "form4 manual", type: "Link", url: "https://formlabs.com/form4.pdf", published: true })
    .returning();
  return { tool, doc };
}

/** What an MCP client proposes: three changes to one tool, in three calls, each storing today's revision. */
async function proposeThree(identity: Identity, toolId: string, docId: string) {
  const ids: string[] = [];
  for (const [actionId, args] of [
    ["resources.add", { tool_id: toolId, title: "Form 4 user manual", url: "https://formlabs.com/form-4-manual.pdf", type: "Manual" }],
    ["resources.edit", { tool_id: toolId, resource_id: docId, type: "Manual" }],
    ["resources.edit", { tool_id: toolId, resource_id: docId, title: "Form 4 quick start" }],
  ] as const) {
    const proposed = await proposeAction(actionById(actionId)!, args, { identity, surface: "mcp", chatId: null });
    if (!proposed.ok) throw new Error(proposed.error);
    ids.push(proposed.proposals[0].id);
  }
  return ids;
}

const docs = async (toolId: string) =>
  (await db.select().from(resources).where(eq(resources.toolId, toolId)).orderBy(asc(resources.title))).map((r) => [r.title, r.type]);

describe("confirming a tool's proposals in one step", () => {
  it("confirms all three in order, though each stored the same revision", async () => {
    const identity = await staff();
    const { tool, doc } = await toolWithManual();
    const ids = await proposeThree(identity, tool.id, doc.id);

    const results = await decideActionProposals({ ids, decision: "confirm" }, identity);
    expect(results.map((r) => r.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(await docs(tool.id)).toEqual([
      ["Form 4 quick start", "Manual"],
      ["Form 4 user manual", "Manual"],
    ]);
    // The trail says which rows ran on a revision this step's own writes moved.
    const stored = await db.select().from(actionProposals).orderBy(asc(actionProposals.createdAt));
    expect(stored.map((row) => row.result)).toEqual([{}, { chained: true }, { chained: true }]);
  });

  it("still answers conflict, and writes nothing, when someone else saved the tool between two rows", async () => {
    const identity = await staff();
    const { tool, doc } = await toolWithManual();
    const ids = await proposeThree(identity, tool.id, doc.id);

    // The first row alone, then a save in the editor, then the other two together.
    expect((await decideActionProposals({ ids: [ids[0]], decision: "confirm" }, identity))[0].status).toBe("confirmed");
    expect(
      await saveTool({ toolId: tool.id, expectedRevision: (await readToolRevision(tool.id))!, patch: { description: "Edited by a person" } })
    ).toMatchObject({ ok: true });

    const results = await decideActionProposals({ ids: ids.slice(1), decision: "confirm" }, identity);
    expect(results.map((r) => r.status)).toEqual(["conflict", "conflict"]);
    expect(await docs(tool.id)).toEqual([
      ["Form 4 user manual", "Manual"],
      ["form4 manual", "Link"],
    ]);
  });

  it("does not carry over between clicks: a row confirmed in an earlier request still makes the rest conflict", async () => {
    const identity = await staff();
    const { tool, doc } = await toolWithManual();
    const ids = await proposeThree(identity, tool.id, doc.id);

    expect((await decideActionProposals({ ids: [ids[0]], decision: "confirm" }, identity))[0].status).toBe("confirmed");
    const results = await decideActionProposals({ ids: [ids[1]], decision: "confirm" }, identity);
    expect(results[0].status).toBe("conflict");
  });

  it("answers conflict for a row whose shown value an earlier row of the same step changed", async () => {
    const identity = await staff();
    const { tool, doc } = await toolWithManual();
    const first = await proposeAction(actionById("resources.edit")!, { tool_id: tool.id, resource_id: doc.id, title: "Form 4 manual" }, {
      identity,
      surface: "mcp",
      chatId: null,
    });
    const second = await proposeAction(actionById("resources.edit")!, { tool_id: tool.id, resource_id: doc.id, title: "Form 4 guide" }, {
      identity,
      surface: "mcp",
      chatId: null,
    });
    if (!first.ok || !second.ok) throw new Error("refused");

    const results = await decideActionProposals({ ids: [first.proposals[0].id, second.proposals[0].id], decision: "confirm" }, identity);
    expect(results.map((r) => r.status)).toEqual(["confirmed", "conflict"]);
    expect(results[1].drifted).toEqual([{ field: "resourceTitle", was: "form4 manual", now: "Form 4 manual" }]);
    expect(await docs(tool.id)).toEqual([["Form 4 manual", "Link"]]);
  });

  it("stops the chain after a row that does not confirm: the rows after it come back as conflict", async () => {
    const identity = await staff();
    const { tool, doc } = await toolWithManual();
    const ids = await proposeThree(identity, tool.id, doc.id);
    // The document the second row edits is renamed by hand: that row's shown "before" drifts.
    await db.update(resources).set({ type: "SOP" }).where(eq(resources.id, doc.id));

    const results = await decideActionProposals({ ids, decision: "confirm" }, identity);
    expect(results.map((r) => r.status)).toEqual(["confirmed", "conflict", "conflict"]);
  });
});
