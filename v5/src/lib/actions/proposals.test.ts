// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq, sql } from "drizzle-orm";
import { addPerson, setUserRole, setUserTitle } from "../../app/admin/users/actions";
import { updateTicket } from "../../app/admin/maintenance/actions";
import { setCorrectionStatus } from "../../app/admin/corrections/actions";
import { resetAuthForTests } from "../auth/config";
import { resolveIdentityFromHeaders, type Identity } from "../auth/identity";
import { CAPABILITIES, capabilitiesForIdentity } from "../capabilities";
import { listAuditEvents } from "../data/audit";
import { findUserById } from "../data/users";
import { getDb, resetDbForTests } from "../db/client";
import { actionProposals, auditEvents, feedback, maintenanceLogs, session, user } from "../db/schema/index";
import { seedUser, signInAsNew } from "../../../test/utils/session";
import { decideActionProposals, proposeAction, typedMatches } from "./proposals";
import { actionById } from "./registry";

/**
 * Propose, then confirm (assistant–GUI parity spec §3.4, §3.5, §10): the same
 * change made from the People page and from a card lands the same rows and
 * the same audit events — except `surface` and `proposal_id` — and every rule
 * is checked again at the click. Real PGlite, real Better Auth sessions, the
 * real admin plugin; only `next/headers` and `next/cache` are stubbed.
 */

const AUTH_SECRET = "action-proposals-test-secret";

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  const db = await getDb();
  await db.delete(actionProposals);
  await db.delete(auditEvents);
  await db.delete(session);
  await db.delete(user);
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function signIn(role: "super_admin" | "admin" | "user", email: string): Promise<Identity> {
  const signedIn = await signInAsNew({ email, role, name: email.split("@")[0] });
  setMockHeaders({ cookie: signedIn.cookie });
  return resolveIdentityFromHeaders();
}

const def = (id: string) => actionById(id)!;

async function proposeAndConfirm(actionId: string, args: unknown, identity: Identity) {
  const proposed = await proposeAction(def(actionId), args, { identity, surface: "assistant", chatId: "chat-1" });
  if (!proposed.ok) throw new Error(`refused: ${proposed.error}`);
  const results = await decideActionProposals({ ids: proposed.proposals.map((p) => p.id), decision: "confirm" }, identity);
  return { proposed, results };
}

/** An audit event without the columns that differ by nature. */
function comparable(event: { action: string; subjectType: string; detail: unknown; actorUserId: string | null }) {
  return { action: event.action, subjectType: event.subjectType, detail: event.detail, actorUserId: event.actorUserId };
}

describe("the same change, from the People page and from a card", () => {
  it("sets a title: same row, same event, surface and proposal id apart", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const a = await seedUser({ email: "luis@cornell.edu", role: "admin", name: "Luis" });
    const b = await seedUser({ email: "niti@cornell.edu", role: "admin", name: "Niti" });

    expect(await setUserTitle({ userId: a.id, title: "Supermaker" })).toMatchObject({ ok: true });
    const { proposed, results } = await proposeAndConfirm("people.set_title", { user_ids: [b.id], title: "Supermaker" }, director);

    // Proposing wrote nothing to the person; the click did.
    expect(results).toEqual([expect.objectContaining({ status: "confirmed", link: "/admin/users" })]);
    expect((await findUserById(a.id))?.title).toBe("Supermaker");
    expect((await findUserById(b.id))?.title).toBe("Supermaker");

    const events = await listAuditEvents();
    const gui = events.find((e) => e.subjectId === a.id)!;
    const card = events.find((e) => e.subjectId === b.id)!;
    expect(comparable(card)).toEqual(comparable(gui));
    expect(gui).toMatchObject({ surface: "gui", proposalId: null, actorUserId: director.userId });
    expect(card).toMatchObject({ surface: "assistant", proposalId: proposed.proposals[0].id, actorUserId: director.userId });
  });

  it("changes a role through the admin plugin, with the confirming person's cookie", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const a = await seedUser({ email: "luis@cornell.edu", role: "user" });
    const b = await seedUser({ email: "niti@cornell.edu", role: "user" });

    expect(await setUserRole({ userId: a.id, role: "admin" })).toMatchObject({ ok: true });
    await proposeAndConfirm("people.set_role", { user_id: b.id, role: "admin" }, director);

    expect((await findUserById(b.id))?.role).toBe("admin");
    const events = (await listAuditEvents()).filter((e) => e.action === "role.changed");
    expect(events.map((e) => [e.subjectId, e.surface]).sort()).toEqual([[a.id, "gui"], [b.id, "assistant"]].sort());
    expect(comparable(events.find((e) => e.subjectId === b.id)!).detail).toEqual({ from: "user", to: "admin" });
  });

  it("adds a person: the same row shape and a user.added event marked as the assistant's", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    expect(await addPerson({ email: "a@cornell.edu", role: "admin", title: "Supermaker" })).toMatchObject({ ok: true });
    await proposeAndConfirm("people.add", { email: "b@cornell.edu", role: "admin", title: "Supermaker" }, director);

    const db = await getDb();
    const [rowA] = await db.select().from(user).where(eq(user.email, "a@cornell.edu"));
    const [rowB] = await db.select().from(user).where(eq(user.email, "b@cornell.edu"));
    expect({ role: rowB.role, title: rowB.title, firstSignedInAt: rowB.firstSignedInAt, emailVerified: rowB.emailVerified }).toEqual({
      role: rowA.role,
      title: rowA.title,
      firstSignedInAt: rowA.firstSignedInAt,
      emailVerified: rowA.emailVerified,
    });
    const added = (await listAuditEvents()).filter((e) => e.action === "user.added");
    expect(added.map((e) => e.surface).sort()).toEqual(["assistant", "gui"]);
  });

  it("resolves a ticket and dismisses a correction the same way as their queues", async () => {
    const staff = await signIn("admin", "sam@cornell.edu");
    const db = await getDb();
    const [t1, t2] = await db
      .insert(maintenanceLogs)
      .values([
        { title: "Belt slipping", status: "open" },
        { title: "Fan noisy", status: "open" },
      ])
      .returning();
    expect(await updateTicket({ logId: t1.id, patch: { status: "resolved", resolution: "Replaced the belt." } })).toMatchObject({ ok: true });
    await proposeAndConfirm("tickets.update", { ticket_ids: [t2.id], status: "resolved", resolution: "Replaced the belt." }, staff);
    const rows = await db.select().from(maintenanceLogs).where(sql`${maintenanceLogs.id} in (${t1.id}, ${t2.id})`);
    const pick = (row: typeof t1) => ({ status: row.status, resolution: row.resolution, dateResolved: row.dateResolved, updatedBy: row.updatedBy });
    expect(pick(rows.find((r) => r.id === t2.id)!)).toEqual(pick(rows.find((r) => r.id === t1.id)!));

    const [c1, c2] = await db
      .insert(feedback)
      .values([
        { issueDescription: "Wrong wattage", status: "new" },
        { issueDescription: "Wrong wattage again", status: "new" },
      ])
      .returning();
    expect(await setCorrectionStatus({ feedbackId: c1.id, status: "dismissed" })).toMatchObject({ ok: true });
    await proposeAndConfirm("corrections.set_status", { correction_ids: [c2.id], status: "dismissed" }, staff);
    const corrections = await db.select().from(feedback).where(sql`${feedback.id} in (${c1.id}, ${c2.id})`);
    expect(corrections.map((c) => c.status)).toEqual(["dismissed", "dismissed"]);
  });
});

describe("checked again at the click", () => {
  it("refuses a proposal whose creator lost the permission in between", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    await seedUser({ email: "boss@cornell.edu", role: "super_admin" });
    const target = await seedUser({ email: "luis@cornell.edu", role: "admin" });
    const proposed = await proposeAction(def("people.set_title"), { user_ids: [target.id], title: "Tech Lead" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    expect(proposed.ok).toBe(true);
    if (!proposed.ok) return;

    const db = await getDb();
    await db.update(user).set({ role: "admin" }).where(eq(user.id, director.userId!));
    const demoted = await resolveIdentityFromHeaders();
    const results = await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, demoted);
    expect(results).toEqual([expect.objectContaining({ status: "failed", error: "not_permitted" })]);
    expect((await findUserById(target.id))?.title).toBeNull();
    const [row] = await db.select().from(actionProposals).where(eq(actionProposals.id, proposed.proposals[0].id));
    expect(row).toMatchObject({ status: "failed", result: { error: "not_permitted" } });
  });

  it("answers somebody else's proposal as not found, and changes nothing", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const target = await seedUser({ email: "luis@cornell.edu", role: "admin" });
    const proposed = await proposeAction(def("people.set_title"), { user_ids: [target.id], title: "X" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    if (!proposed.ok) throw new Error("refused");
    const other = await signIn("super_admin", "other@cornell.edu");
    expect(await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "confirm" }, other)).toEqual([
      { id: proposed.proposals[0].id, status: "not_found" },
    ]);
    expect((await findUserById(target.id))?.title).toBeNull();
  });

  it("answers an expired card as expired and a second click as already decided", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const target = await seedUser({ email: "luis@cornell.edu", role: "admin" });
    const first = await proposeAndConfirm("people.set_title", { user_ids: [target.id], title: "A" }, director);
    expect(await decideActionProposals({ ids: [first.proposed.proposals[0].id], decision: "confirm" }, director)).toEqual([
      { id: first.proposed.proposals[0].id, status: "already_decided" },
    ]);

    const second = await proposeAction(def("people.set_title"), { user_ids: [target.id], title: "B" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    if (!second.ok) throw new Error("refused");
    const db = await getDb();
    await db.update(actionProposals).set({ expiresAt: sql`now() - interval '1 second'` }).where(eq(actionProposals.id, second.proposals[0].id));
    expect(await decideActionProposals({ ids: [second.proposals[0].id], decision: "confirm" }, director)).toEqual([
      { id: second.proposals[0].id, status: "expired" },
    ]);
    expect((await findUserById(target.id))?.title).toBe("A");
  });

  it("confirms the rest of a batch when one item is refused at the click", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const a = await seedUser({ email: "a@cornell.edu", role: "admin" });
    const b = await seedUser({ email: "b@cornell.edu", role: "admin" });
    const proposed = await proposeAction(def("people.set_title"), { user_ids: [a.id, b.id], title: "Supermaker" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    if (!proposed.ok) throw new Error("refused");
    const db = await getDb();
    await db.delete(user).where(eq(user.id, a.id));
    const results = await decideActionProposals({ ids: proposed.proposals.map((p) => p.id), decision: "confirm" }, director);
    expect(results.map((r) => r.status).sort()).toEqual(["confirmed", "failed"]);
    expect((await findUserById(b.id))?.title).toBe("Supermaker");
  });

  it("cancels without running anything", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const target = await seedUser({ email: "luis@cornell.edu", role: "admin" });
    const proposed = await proposeAction(def("people.set_title"), { user_ids: [target.id], title: "X" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    if (!proposed.ok) throw new Error("refused");
    expect(await decideActionProposals({ ids: [proposed.proposals[0].id], decision: "cancel" }, director)).toEqual([
      { id: proposed.proposals[0].id, status: "cancelled" },
    ]);
    expect((await findUserById(target.id))?.title).toBeNull();
  });
});

describe("proposing", () => {
  it("stores nothing and names the refusal the page would give", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const floorless = await seedUser({ email: "luis@cornell.edu", role: "admin" });
    expect(await proposeAction(def("people.set_title"), { user_ids: [floorless.id], title: "x".repeat(61) }, { identity: director, surface: "assistant", chatId: null })).toEqual({
      ok: false,
      error: "invalid_input",
    });
    expect(await proposeAction(def("people.set_role"), { user_id: director.userId, role: "user" }, { identity: director, surface: "assistant", chatId: null })).toMatchObject({
      ok: false,
      error: "last_super_admin",
    });
    expect(await proposeAction(def("people.set_role"), { user_id: "nobody", role: "admin" }, { identity: director, surface: "assistant", chatId: null })).toMatchObject({
      ok: false,
      error: "unknown_user",
    });
    const db = await getDb();
    expect(await db.select().from(actionProposals)).toEqual([]);
  });

  it("refuses a caller without the permission before reading anything", async () => {
    const staff = await signIn("admin", "sam@cornell.edu");
    const target = await seedUser({ email: "luis@cornell.edu", role: "user" });
    expect(await proposeAction(def("people.set_title"), { user_ids: [target.id], title: "X" }, { identity: staff, surface: "assistant", chatId: null })).toEqual({
      ok: false,
      error: "not_permitted",
    });
  });

  it("lists a refused item beside the proposed ones and never proposes a subject twice", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const a = await seedUser({ email: "a@cornell.edu", role: "admin" });
    const result = await proposeAction(def("people.set_title"), { user_ids: [a.id, a.id, "ghost"], title: "Supermaker" }, {
      identity: director,
      surface: "assistant",
      chatId: null,
    });
    expect(result).toMatchObject({ ok: true, refused: [{ subjectId: "ghost", error: "unknown_user" }] });
    if (result.ok) expect(result.proposals).toHaveLength(1);
  });

  it("previews from the database, never from the arguments' prose", async () => {
    const director = await signIn("super_admin", "dee@cornell.edu");
    const a = await seedUser({ email: "a@cornell.edu", role: "user", name: "Ada Lovelace" });
    const result = await proposeAction(def("people.set_role"), { user_id: a.id, role: "admin" }, { identity: director, surface: "assistant", chatId: null });
    if (!result.ok) throw new Error("refused");
    expect(result.proposals[0].preview).toEqual({
      summary: { key: "people_set_role", values: { name: "Ada Lovelace" } },
      rows: [{ field: "role", before: "user", after: "admin", format: "role" }],
      subjectName: "Ada Lovelace",
      link: "/admin/users",
    });
  });

  it("offers a student no action tool at all", () => {
    const student = capabilitiesForIdentity(CAPABILITIES, { role: "user" });
    const actions = student.find((c) => c.id === "actions")!;
    expect(actions.tools).toEqual([]);
    const staffTools = capabilitiesForIdentity(CAPABILITIES, { role: "admin" }).find((c) => c.id === "actions")!.tools.map((t) => t.name);
    expect(staffTools).not.toContain("set_person_role");
    expect(staffTools).toContain("update_ticket");
  });
});

describe("typedMatches (destructive confirmation, §5.4)", () => {
  it.each([
    ["Casey Rivera", "Casey Rivera", true],
    ["  casey   rivera ", "Casey Rivera", true],
    ["Ｃａｓｅｙ Rivera", "Casey Rivera", true],
    ["Casey", "Casey Rivera", false],
    [undefined, "Casey Rivera", false],
    ["", "", false],
  ])("%j against %j is %s", (typed, name, expected) => {
    expect(typedMatches(typed as string | undefined, name)).toBe(expected);
  });
});
