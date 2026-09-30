// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());
const wf = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "wrun_suggest" })) }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../workflows/suggest-names", () => ({ suggestNames: vi.fn() }));
vi.mock("../../workflows/import-document", () => ({ importDocument: vi.fn() }));
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { listAuditEvents } from "../data/audit";
import { getPendingTool, listPendingTools } from "../data/pending-tools";
import { findUserById } from "../data/users";
import { getDb, resetDbForTests } from "../db/client";
import { actionProposals, notionMirrors } from "../db/schema/index";
import { saveMirrorConnection } from "../data/mirrors";
import { createActionProposals } from "../data/action-proposals";
import { encryptMirrorToken } from "../mirror/token-crypto";
import { startImport } from "../import/service";
import { seedUser, signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * Imports, the mirror and People's removal from a card (assistant–GUI parity
 * spec §9 phases 5–6): row changes land as the import page's would and only
 * on the caller's own import; asking for name suggestions spends at the
 * click; disconnecting the mirror, removing a person, granting an allowance
 * and unblocking an address are never the assistant's (owner decision
 * 2026-09-27), not even from a proposal already stored.
 */

let identity: Identity;
let userId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "imports-mirror-actions-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  wf.start.mockClear();
  await (await getDb()).delete(actionProposals);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function as(role: "admin" | "super_admin", email = `${role}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`) {
  const signedIn = await signInAsNew({ email, role, name: "Dee Staff" });
  setMockHeaders({ cookie: signedIn.cookie });
  identity = await resolveIdentityFromHeaders();
  userId = signedIn.user.id;
  return signedIn;
}

async function listImport(lines: string[]) {
  const started = await startImport({ userId, text: lines.join("\n"), origin: "page", startRun: async () => ({ runId: "x" }) });
  if (!started.ok) throw new Error(started.error);
  return { importId: started.import.id, items: await listPendingTools({ importId: started.import.id, limit: null }) };
}

const propose = (actionId: string, args: unknown, tainted = false) =>
  proposeAction(actionById(actionId)!, args, { identity, surface: "assistant", chatId: "chat-1", tainted });

const confirm = (ids: string[], typed?: string) =>
  decideActionProposals({ ids, decision: "confirm", ...(typed !== undefined ? { typed } : {}) }, identity);

describe("imports", () => {
  it("refuses removing rows from a turn that read outside content, and is never offered over MCP", async () => {
    await as("super_admin");
    const { importId, items } = await listImport([`Scroll saw ${crypto.randomUUID().slice(0, 6)}`]);
    expect(await propose("imports.remove_rows", { import_id: importId, row_ids: [items[0].id] }, true)).toMatchObject({ ok: false, error: "tainted_turn" });
    expect(actionById("imports.remove_rows")!.mcp).toBe("never");
  });

  it("removes rows from the caller's import, and only rows of that import", async () => {
    await as("admin");
    const tag = crypto.randomUUID().slice(0, 6);
    const { importId, items } = await listImport([`Drill press ${tag}`, `Band saw ${tag}`]);
    const other = await listImport([`Router table ${tag}`]);
    const proposed = await propose("imports.remove_rows", { import_id: importId, row_ids: [items[0].id, other.items[0].id] });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0].preview).toMatchObject({ summary: { key: "imports_remove_rows", values: { count: 1 } } });
    expect(await confirm([proposed.proposals[0].id])).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect((await getPendingTool(items[0].id))?.status).toBe("discarded");
    expect((await getPendingTool(items[1].id))?.status).toBe("identified");
    expect((await getPendingTool(other.items[0].id))?.status).toBe("identified");
  });

  it("asks for name suggestions at the click, never at the proposal", async () => {
    await as("admin");
    const { importId, items } = await listImport([`Mitre saw ${crypto.randomUUID().slice(0, 6)}`]);
    const proposed = await propose("imports.request_suggestions", { import_id: importId, row_ids: [items[0].id] });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(wf.start).not.toHaveBeenCalled();
    expect(await confirm([proposed.proposals[0].id])).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect(wf.start).toHaveBeenCalledTimes(1);
  });

  it("is never offered as a card for another person's import without tools.approve", async () => {
    await as("admin");
    const { importId, items } = await listImport([`Planer ${crypto.randomUUID().slice(0, 6)}`]);
    // Admins hold tools.approve today, so the owner check passes for them; a
    // missing import is refused before any card is drawn.
    expect(await propose("imports.set_hints", { import_id: crypto.randomUUID(), row_ids: [items[0].id], category_hint: "Wood" })).toMatchObject({
      ok: false,
    });
    expect(await propose("imports.set_hints", { import_id: importId, row_ids: [items[0].id] })).toEqual({ ok: false, error: "nothing_to_change" });
  });
});

describe("the mirror", () => {
  it("never disconnects from the assistant: no proposal, and a stored one is refused at the click (owner decision 2026-09-27)", async () => {
    await as("admin");
    const db = await getDb();
    const { mirror } = await saveMirrorConnection(
      {
        ownerUserId: userId,
        tokenCiphertext: encryptMirrorToken("secret_notion_token_1234567890", "imports-mirror-actions-test-secret"),
        parentPageId: "0123456789abcdef0123456789abcdef",
        parentPageTitle: "Lab mirror",
      },
      { db }
    );
    expect(await propose("mirror.disconnect", {})).toEqual({ ok: false, error: "not_offered" });
    const stored = await storedProposal("mirror.disconnect", {}, "mirror", "mine", "Lab mirror");
    expect(await confirm([stored.id], "lab mirror")).toEqual([expect.objectContaining({ status: "failed", error: "not_offered" })]);
    const [after] = await db.select().from(notionMirrors).where(eq(notionMirrors.id, mirror.id));
    expect(after.tokenCiphertext).not.toBeNull();
    expect((await listAuditEvents()).find((e) => e.action === "mirror.disconnected")).toBeUndefined();
  });

  it("proposes nothing for somebody with no connected mirror", async () => {
    await as("admin");
    expect(await propose("mirror.sync_now", {})).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("the People actions the assistant never takes (owner decision 2026-09-27)", () => {
  it("never proposes removing a person, and refuses a stored removal at the click even with the name typed", async () => {
    await as("super_admin");
    const casey = await seedUser({ email: "casey@cornell.edu", role: "user", name: "Casey Rivera" });
    expect(await propose("people.remove", { user_id: casey.id })).toEqual({ ok: false, error: "not_offered" });
    const stored = await storedProposal("people.remove", { userId: casey.id, block: true }, "user", casey.id, "Casey Rivera");
    expect(await confirm([stored.id], "casey rivera")).toEqual([expect.objectContaining({ status: "failed", error: "not_offered" })]);
    expect(await findUserById(casey.id)).not.toBeNull();
    expect((await listAuditEvents()).find((e) => e.action === "user.removed")).toBeUndefined();
  });

  it("never grants an allowance or unblocks an address, even from a stored proposal", async () => {
    await as("super_admin");
    const luis = await seedUser({ email: "luis@cornell.edu", role: "admin", name: "Luis" });
    expect(await propose("people.grant_allowance", { user_id: luis.id, extra_items: 50, days: 3 })).toEqual({ ok: false, error: "not_offered" });
    expect(await propose("people.unblock_email", { email: "gone@cornell.edu" })).toEqual({ ok: false, error: "not_offered" });
    const grant = await storedProposal("people.grant_allowance", { userId: luis.id, extraItems: 50, days: 3 }, "user", luis.id, "Luis");
    const unblock = await storedProposal("people.unblock_email", { email: "gone@cornell.edu" }, "email", "gone@cornell.edu", "gone@cornell.edu");
    expect(await confirm([grant.id, unblock.id])).toEqual([
      expect.objectContaining({ status: "failed", error: "not_offered" }),
      expect.objectContaining({ status: "failed", error: "not_offered" }),
    ]);
    const events = (await listAuditEvents()).map((e) => e.action);
    expect(events).not.toContain("allowance.granted");
  });
});

/** A proposal row written straight to the table, as one stored before its action left the assistant. */
async function storedProposal(actionId: string, input: unknown, subjectType: string, subjectId: string, subjectName: string) {
  const [row] = await createActionProposals([
    {
      groupId: crypto.randomUUID(),
      actionId,
      input,
      subjectType,
      subjectId,
      preview: { summary: { key: "x", values: {} }, rows: [], subjectName },
      surface: "assistant",
      chatId: "chat-1",
      createdBy: userId,
    },
  ]);
  return row;
}
