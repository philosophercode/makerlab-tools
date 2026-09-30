// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../../../lib/manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { resetAuthForTests } from "../../../lib/auth/config";
import { createChatProposal, getChatProposals, loadPendingDraft } from "../../../lib/data/chat-proposals";
import { completeResearch, createPendingBatch, markResearching, queueForResearch } from "../../../lib/data/pending-tools";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { chatProposals, tools } from "../../../lib/db/schema/index";
import { requestMirrorPush } from "../../../lib/mirror/trigger";
import { researchFixture } from "../../../lib/refresh/fixtures.test-helpers";
import type { FieldProposal } from "../../../lib/refresh/types";
import { signInAsNew } from "../../../../test/utils/session";
import { POST } from "./route";

/**
 * Accepting the assistant's proposals (refresh research spec §12.2, §12.5
 * "Integration"): the click re-checks permission and the revision; a stale
 * revision is a conflict with the record's value now; a pending accept writes
 * the item's research; siblings of an accepted card are not made conflicts by
 * it; expired and decided cards are refused.
 */

const verified = [{ quote: "a quote on the page", url: "https://formlabs.example/form4", verified: true }];
let toolId: string;

function card(field: FieldProposal["field"], proposed: unknown, current: unknown = null): FieldProposal {
  return { id: field, field, kind: current ? "differs" : "new", safety: false, current, proposed, citations: verified, decision: "pending" };
}

async function post(body: unknown, cookie?: string) {
  const res = await POST(
    new NextRequest("http://localhost/api/chat-proposals", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the route's loosely-typed JSON, read by each test.
  return { status: res.status, body: (await res.json()) as any };
}

async function admin() {
  return signInAsNew({ email: `proposals-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role: "admin" });
}

async function toolCard(field: FieldProposal["field"], proposed: unknown, createdBy: string | null = null) {
  const revision = (await readToolRevision(toolId))!;
  return createChatProposal({ subjectKind: "tool", subjectId: toolId, proposal: card(field, proposed), baseRevision: revision, chatId: "c1", createdBy });
}

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "chat-proposals-test-secret");
  resetAuthForTests();
  vi.mocked(requestMirrorPush).mockClear();
  const db = await getDb();
  const [tool] = await db
    .insert(tools)
    .values({ slug: `curate-${crypto.randomUUID().slice(0, 6)}`, name: "Form 4 copy", published: true })
    .returning({ id: tools.id });
  toolId = tool.id;
});

afterEach(async () => {
  const db = await getDb();
  await db.delete(chatProposals);
  resetAuthForTests();
  resetDbForTests();
});

it("refuses a visitor and a student before looking at any card", async () => {
  const id = await toolCard("use_restrictions", "Trained users only.");
  expect((await post({ ids: [id], decision: "accept" })).status).toBe(401);
  const student = await signInAsNew({ email: "casey-proposals@cornell.edu", role: "user" });
  expect((await post({ ids: [id], decision: "accept" }, student.cookie)).status).toBe(403);
  const db = await getDb();
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row.useRestrictions).toBeNull();
});

it("accepts through the editor path, closes the card, and asks the mirror to catch up", async () => {
  const signedIn = await admin();
  const id = await toolCard("use_restrictions", "Trained users only.", signedIn.user.id);
  const { status, body } = await post({ ids: [id], decision: "accept" }, signedIn.cookie);
  expect(status).toBe(200);
  expect(body.results).toEqual([expect.objectContaining({ id, status: "accepted" })]);
  const db = await getDb();
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row.useRestrictions).toBe("Trained users only.");
  expect((await getChatProposals([id]))[0]).toMatchObject({ decidedBy: signedIn.user.id, proposal: expect.objectContaining({ decision: "accepted" }) });
  expect(requestMirrorPush).toHaveBeenCalled();
  // A decided card is not decided again.
  expect((await post({ ids: [id], decision: "reject" }, signedIn.cookie)).body.results[0]).toMatchObject({ status: "refused", error: "not_editable" });
});

it("a stale revision is a conflict showing the record's value now; accepted again it lands", async () => {
  const signedIn = await admin();
  const id = await toolCard("use_restrictions", "Trained users only.");
  const db = await getDb();
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set use_restrictions = 'Edited this afternoon.', updated_at = updated_at + interval '1 second' where id = ${toolId}`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);

  const { body } = await post({ ids: [id], decision: "accept" }, signedIn.cookie);
  expect(body.results[0]).toMatchObject({ status: "conflict", proposal: { decision: "conflict", current: "Edited this afternoon." } });
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row.useRestrictions).toBe("Edited this afternoon.");

  expect((await post({ ids: [id], decision: "accept" }, signedIn.cookie)).body.results[0]).toMatchObject({ status: "accepted" });
});

it("accepting one card does not turn its siblings from the same turn into conflicts", async () => {
  const signedIn = await admin();
  const first = await toolCard("use_restrictions", "Trained users only.");
  const second = await toolCard("emergency_stop", "Red button on the front.");
  expect((await post({ ids: [first], decision: "accept" }, signedIn.cookie)).body.results[0].status).toBe("accepted");
  expect((await post({ ids: [second], decision: "accept" }, signedIn.cookie)).body.results[0].status).toBe("accepted");
  const db = await getDb();
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row).toMatchObject({ useRestrictions: "Trained users only.", emergencyStop: "Red button on the front." });
});

it("refuses a card whose quote was not found, and an expired one", async () => {
  const signedIn = await admin();
  const revision = (await readToolRevision(toolId))!;
  const unverified = await createChatProposal({
    subjectKind: "tool",
    subjectId: toolId,
    proposal: { ...card("description", "Invented."), citations: [{ quote: "x", url: "https://a.example/", verified: false }] },
    baseRevision: revision,
    chatId: null,
    createdBy: null,
  });
  expect((await post({ ids: [unverified], decision: "accept" }, signedIn.cookie)).body.results[0]).toMatchObject({ error: "unverified_quote" });

  const old = await toolCard("tags", ["Resin"]);
  const db = await getDb();
  await db.update(chatProposals).set({ expiresAt: sql`now() - interval '1 day'` }).where(eq(chatProposals.id, old));
  expect((await post({ ids: [old], decision: "accept" }, signedIn.cookie)).body.results[0]).toMatchObject({ error: "expired" });
});

it("a pending item's accept writes its research — the preliminary page's draft", async () => {
  const signedIn = await admin();
  const { items } = await createPendingBatch({ createdBy: signedIn.user.id, items: [{ name: "Grey dust box" }] });
  const pendingId = items[0].id;
  const requestId = crypto.randomUUID();
  await queueForResearch([pendingId], { requestedBy: signedIn.user.id, requestId });
  await markResearching(pendingId, { requestId });
  await completeResearch(pendingId, researchFixture({ useRestrictions: null }), { requestId });
  const draft = (await loadPendingDraft(pendingId))!;
  const id = await createChatProposal({
    subjectKind: "pending",
    subjectId: pendingId,
    proposal: card("use_restrictions", "Not for flammable dust."),
    baseRevision: draft.revision,
    chatId: null,
    createdBy: signedIn.user.id,
  });
  expect((await post({ ids: [id], decision: "accept" }, signedIn.cookie)).body.results[0]).toMatchObject({ status: "accepted" });
  expect((await loadPendingDraft(pendingId))?.research?.useRestrictions).toBe("Not for flammable dust.");
});

it("rejects without touching the record", async () => {
  const signedIn = await admin();
  const id = await toolCard("use_restrictions", "Trained users only.");
  expect((await post({ ids: [id], decision: "reject" }, signedIn.cookie)).body.results[0]).toMatchObject({ status: "rejected" });
  const db = await getDb();
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  expect(row.useRestrictions).toBeNull();
});
