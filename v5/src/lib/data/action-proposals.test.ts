// @vitest-environment node
import { eq, sql } from "drizzle-orm";
import { createPgliteDb } from "../db/pglite";
import { actionProposals, user } from "../db/schema/index";
import type { Db } from "../db/types";
import {
  cancelActionProposals,
  claimActionProposals,
  countOpenProposals,
  createActionProposals,
  getActionProposals,
  listChatActionProposals,
  settleActionProposal,
  type NewActionProposal,
} from "./action-proposals";
import { removeUserAccount } from "./user-removal";

/**
 * `action_proposals` (assistant–GUI parity spec §3.5): who may decide a row,
 * that it is decided once, and when it expires.
 */

let db: Db;

beforeEach(async () => {
  db = await createPgliteDb();
  await db.insert(user).values([
    { id: "u-dee", name: "Dee Rector", email: "dee@cornell.edu", role: "super_admin" },
    { id: "u-sam", name: "Sam Maker", email: "sam@cornell.edu", role: "admin" },
  ]);
});

function proposal(overrides: Partial<NewActionProposal> = {}): NewActionProposal {
  return {
    groupId: crypto.randomUUID(),
    actionId: "people.set_title",
    input: { userId: "u-sam", title: "Supermaker" },
    subjectType: "user",
    subjectId: "u-sam",
    preview: { subjectName: "Sam Maker", rows: [], summary: { key: "people_set_title", values: { name: "Sam Maker" } } },
    surface: "assistant",
    chatId: "chat-1",
    createdBy: "u-dee",
    ...overrides,
  };
}

describe("action proposals", () => {
  it("stores a chat proposal open for an hour, by the database's clock", async () => {
    const [row] = await createActionProposals([proposal()], { db });
    expect(row).toMatchObject({ status: "open", surface: "assistant", createdBy: "u-dee", tainted: false, expired: false });
    const result = (await db.execute(
      sql`select round(extract(epoch from (expires_at - created_at)) / 60)::int as minutes from action_proposals where id = ${row.id}`
    )) as unknown as { rows: { minutes: number }[] };
    const [{ minutes }] = result.rows;
    expect(minutes).toBe(60);
  });

  it("keeps an MCP proposal for seven days (§11 answer 7)", async () => {
    const [row] = await createActionProposals([proposal({ surface: "mcp", chatId: null })], { db });
    const days = (row.expiresAt.getTime() - row.createdAt.getTime()) / 86_400_000;
    expect(Math.round(days)).toBe(7);
  });

  it("lets only the creator claim, and claims each row once", async () => {
    const [row] = await createActionProposals([proposal()], { db });
    expect(await claimActionProposals([row.id], "u-sam", { db })).toEqual([]);
    const [claimed] = await claimActionProposals([row.id], "u-dee", { db });
    expect(claimed).toMatchObject({ id: row.id, status: "confirming" });
    // A second tab's click.
    expect(await claimActionProposals([row.id], "u-dee", { db })).toEqual([]);
  });

  it("claims nothing once a row has expired, and reports it expired", async () => {
    const [row] = await createActionProposals([proposal()], { db });
    await db.update(actionProposals).set({ expiresAt: sql`now() - interval '1 minute'` }).where(eq(actionProposals.id, row.id));
    expect(await claimActionProposals([row.id], "u-dee", { db })).toEqual([]);
    expect((await getActionProposals([row.id], { db }))[0]).toMatchObject({ status: "open", expired: true });
    expect(await countOpenProposals("u-dee", { db })).toBe(0);
  });

  it("settles only a claimed row, with who decided and the outcome", async () => {
    const [row] = await createActionProposals([proposal()], { db });
    // Not claimed: nothing to settle.
    await settleActionProposal(row.id, { status: "confirmed", result: {}, decidedBy: "u-dee" }, { db });
    expect((await getActionProposals([row.id], { db }))[0].status).toBe("open");

    await claimActionProposals([row.id], "u-dee", { db });
    await settleActionProposal(row.id, { status: "failed", result: { error: "not_permitted" }, decidedBy: "u-dee" }, { db });
    expect((await getActionProposals([row.id], { db }))[0]).toMatchObject({
      status: "failed",
      result: { error: "not_permitted" },
      decidedBy: "u-dee",
    });
  });

  it("cancels only the creator's open rows", async () => {
    const [mine, other] = await createActionProposals([proposal(), proposal()], { db });
    await claimActionProposals([other.id], "u-dee", { db });
    expect(await cancelActionProposals([mine.id], "u-sam", { db })).toEqual([]);
    expect(await cancelActionProposals([mine.id, other.id], "u-dee", { db })).toEqual([mine.id]);
  });

  it("counts open proposals per person and ignores ids that are not uuids", async () => {
    await createActionProposals([proposal(), proposal(), proposal({ createdBy: "u-sam" })], { db });
    expect(await countOpenProposals("u-dee", { db })).toBe(2);
    expect(await getActionProposals(["nope", "'; drop table user;--"], { db })).toEqual([]);
  });

  it("lists one person's proposals in one chat, newest first", async () => {
    await createActionProposals([proposal({ chatId: "chat-1" })], { db });
    await createActionProposals([proposal({ chatId: "chat-2" })], { db });
    await createActionProposals([proposal({ chatId: "chat-1", createdBy: "u-sam" })], { db });
    const rows = await listChatActionProposals("chat-1", "u-dee", { db });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ chatId: "chat-1", createdBy: "u-dee" });
  });

  it("keeps the proposer's name when their account is removed", async () => {
    const [row] = await createActionProposals([proposal({ createdBy: "u-sam" })], { db });
    expect(await removeUserAccount({ userId: "u-sam", actorUserId: "u-dee" }, { db })).toMatchObject({ ok: true });
    const [after] = await db.select().from(actionProposals).where(eq(actionProposals.id, row.id));
    expect(after).toMatchObject({ createdBy: null, createdByName: "Sam Maker" });
  });

  it("refuses a status or surface outside the vocabulary", async () => {
    await expect(db.insert(actionProposals).values({ ...proposal(), status: "done", expiresAt: sql`now()` })).rejects.toThrow();
    await expect(db.insert(actionProposals).values({ ...proposal(), surface: "gui", expiresAt: sql`now()` })).rejects.toThrow();
  });
});
