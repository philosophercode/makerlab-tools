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
import { actionProposals, notionMirrors, user } from "../db/schema/index";
import { saveMirrorConnection } from "../data/mirrors";
import { encryptMirrorToken } from "../mirror/token-crypto";
import { startImport } from "../import/service";
import { seedUser, signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction } from "./proposals";
import { actionById } from "./registry";

/**
 * Imports, the mirror and People's removal from a card (assistant–GUI parity
 * spec §9 phases 5–6): row changes land as the import page's would and only
 * on the caller's own import; asking for name suggestions spends at the
 * click; disconnecting the mirror and removing a person need the typed name,
 * are audited as the assistant's, and are never proposed from a turn that
 * read outside content.
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
  it("disconnects the caller's own mirror with its page's title typed, audited as the assistant's", async () => {
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
    const proposed = await propose("mirror.disconnect", {});
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0].preview).toMatchObject({ subjectName: "Lab mirror", summary: { key: "mirror_disconnect" } });
    expect(await confirm([proposed.proposals[0].id], "lab mirror")).toEqual([expect.objectContaining({ status: "confirmed" })]);
    const [after] = await db.select().from(notionMirrors).where(eq(notionMirrors.id, mirror.id));
    expect(after.tokenCiphertext).toBeNull();
    const event = (await listAuditEvents()).find((e) => e.action === "mirror.disconnected");
    expect(event).toMatchObject({ surface: "assistant", subjectId: mirror.id, actorUserId: userId });
  });

  it("proposes nothing for somebody with no connected mirror", async () => {
    await as("admin");
    expect(await propose("mirror.sync_now", {})).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("removing a person (§5.4)", () => {
  it("is refused in a tainted turn, and needs the name typed in a clean one", async () => {
    await as("super_admin");
    const casey = await seedUser({ email: "casey@cornell.edu", role: "user", name: "Casey Rivera" });
    expect(await propose("people.remove", { user_id: casey.id }, true)).toEqual({ ok: false, error: "tainted_turn" });

    const proposed = await propose("people.remove", { user_id: casey.id });
    if (!proposed.ok) throw new Error(proposed.error);
    expect(proposed.proposals[0].preview).toMatchObject({
      summary: { key: "people_remove", values: { name: "Casey Rivera" } },
      subjectName: "Casey Rivera",
    });
    expect(await confirm([proposed.proposals[0].id], "Casey")).toEqual([
      expect.objectContaining({ status: "failed", error: "confirmation_mismatch" }),
    ]);
    expect(await findUserById(casey.id)).not.toBeNull();

    expect(await confirm([proposed.proposals[0].id], "casey rivera")).toEqual([expect.objectContaining({ status: "confirmed" })]);
    expect(await findUserById(casey.id)).toBeNull();
    const removed = (await listAuditEvents()).find((e) => e.action === "user.removed");
    expect(removed).toMatchObject({ surface: "assistant", proposalId: proposed.proposals[0].id });
  });

  it("refuses removing yourself before any card is drawn", async () => {
    await as("super_admin");
    expect(await propose("people.remove", { user_id: userId })).toMatchObject({ ok: false, error: "self_remove" });
    expect((await (await getDb()).select().from(user).where(eq(user.id, userId))).length).toBe(1);
  });
});
