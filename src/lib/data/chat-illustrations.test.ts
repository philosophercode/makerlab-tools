// @vitest-environment node
import { eq } from "drizzle-orm";
import { insertUserRow } from "../../../test/utils/session";
import { createPgliteDb } from "../db/pglite";
import { chatIllustrations, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { failIllustration, findReadyIllustration, finishIllustration, reserveIllustration } from "./chat-illustrations";

/**
 * The chat illustrations ledger against PGlite (gateway spec amendment
 * 2026-10-07): the per-person cap and the lab-wide budget over 24 hours,
 * failures that cost nobody a place, the picture served only to its owner,
 * and the row leaving with its person.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(chatIllustrations);
});

const DAY = 24 * 60 * 60_000;
const CAPS = { perPersonLimit: 3, labBudgetUsd: 1, windowMs: DAY };

function reserve(userId: string, overrides: Partial<Parameters<typeof reserveIllustration>[0]> = {}) {
  return reserveIllustration(
    { userId, kind: "plan", model: "recraft/recraft-v4.1-flash", estimatedCostUsd: 0.007, ...CAPS, ...overrides },
    { db }
  );
}

async function person(): Promise<string> {
  return (await insertUserRow(db)).id;
}

describe("reserveIllustration", () => {
  it("takes a pending place at the estimated cost", async () => {
    const userId = await person();
    const result = await reserve(userId);
    expect(result.ok).toBe(true);
    const [row] = await db.select().from(chatIllustrations).where(eq(chatIllustrations.id, (result as { id: string }).id));
    expect(row).toMatchObject({ userId, kind: "plan", status: "pending", model: "recraft/recraft-v4.1-flash", costUsd: 0.007, blobPathname: null });
  });

  it("refuses a person's fourth in 24 hours, and not somebody else's first", async () => {
    const casey = await person();
    for (let i = 0; i < 3; i += 1) expect((await reserve(casey)).ok).toBe(true);
    expect(await reserve(casey)).toEqual({ ok: false, reason: "person_limit", used: 3 });
    expect((await reserve(await person())).ok).toBe(true);
  });

  it("gives back the place of a failed one, and counts only the last 24 hours", async () => {
    const casey = await person();
    const first = await reserve(casey);
    await failIllustration((first as { id: string }).id, 0, { db });
    await db.insert(chatIllustrations).values({
      userId: casey,
      kind: "concept",
      model: "m/x",
      costUsd: 0.007,
      status: "ready",
      createdAt: new Date(Date.now() - DAY - 60_000),
    });
    for (let i = 0; i < 3; i += 1) expect((await reserve(casey)).ok).toBe(true);
    expect((await reserve(casey)).ok).toBe(false);
  });

  it("refuses everybody once the lab's spend would pass the budget, failed calls' cost included", async () => {
    const a = await person();
    const b = await person();
    await db.insert(chatIllustrations).values([
      { userId: a, kind: "plan", model: "m/x", costUsd: 0.6, status: "ready" },
      // An image the model returned and the check refused still cost what the Gateway reported.
      { userId: a, kind: "plan", model: "m/x", costUsd: 0.35, status: "failed" },
    ]);
    expect((await reserve(b, { estimatedCostUsd: 0.05 })).ok).toBe(true);
    expect(await reserve(b, { estimatedCostUsd: 0.05 })).toMatchObject({ ok: false, reason: "lab_budget" });
  });

  it("lets two requests at once take only the last place", async () => {
    const casey = await person();
    await reserve(casey);
    await reserve(casey);
    const both = await Promise.all([reserve(casey), reserve(casey)]);
    expect(both.filter((r) => r.ok)).toHaveLength(1);
  });
});

describe("finishing, failing and serving", () => {
  it("serves a made picture to its owner only", async () => {
    const casey = await person();
    const other = await person();
    const { id } = (await reserve(casey)) as { id: string };
    expect(await findReadyIllustration(id, casey, { db })).toBeNull();

    await finishIllustration(id, { blobPathname: "chat/illustrations/x.png", contentType: "image/png", width: 1024, height: 1024, costUsd: 0.007 }, { db });

    expect(await findReadyIllustration(id, casey, { db })).toEqual({ id, blobPathname: "chat/illustrations/x.png", contentType: "image/png" });
    expect(await findReadyIllustration(id, other, { db })).toBeNull();
    expect(await findReadyIllustration("not-a-uuid", casey, { db })).toBeNull();
    const [row] = await db.select().from(chatIllustrations).where(eq(chatIllustrations.id, id));
    expect(row.status).toBe("ready");
    expect(row.finishedAt).not.toBeNull();
  });

  it("serves nothing for a failed one", async () => {
    const casey = await person();
    const { id } = (await reserve(casey)) as { id: string };
    await failIllustration(id, 0, { db });
    expect(await findReadyIllustration(id, casey, { db })).toBeNull();
    const [row] = await db.select().from(chatIllustrations).where(eq(chatIllustrations.id, id));
    expect(row).toMatchObject({ status: "failed", costUsd: 0 });
  });

  it("leaves with its person", async () => {
    const casey = await person();
    await reserve(casey);
    await db.delete(user).where(eq(user.id, casey));
    expect(await db.select().from(chatIllustrations)).toEqual([]);
  });

  it("refuses a kind or status outside the vocabulary", async () => {
    const casey = await person();
    await expect(db.insert(chatIllustrations).values({ userId: casey, kind: "photo", model: "m/x", costUsd: 0 })).rejects.toThrow();
    await expect(
      db.insert(chatIllustrations).values({ userId: casey, kind: "plan", model: "m/x", costUsd: 0, status: "published" })
    ).rejects.toThrow();
  });
});
