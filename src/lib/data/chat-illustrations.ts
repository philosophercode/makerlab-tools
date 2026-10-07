import { and, count, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { getDb } from "../db/client.ts";
import { chatIllustrations } from "../db/schema/index.ts";
import type { IllustrationKind } from "../db/schema/vocabulary.ts";
import type { Db } from "../db/types.ts";
import { isUuid } from "./uuid.ts";

/**
 * The chat illustrations ledger (`chat_illustrations`, migration `0031`;
 * gateway spec amendment 2026-10-07 "Generated illustrations in the chat").
 *
 * Both caps are counted from it over the last 24 hours: the person's
 * illustrations (pending or made — a failed one is not theirs to lose), and
 * the lab's spend (every row's `cost_usd`; a failed call records 0).
 *
 * Relative imports with `.ts` extensions, no `@/` alias and no
 * `"server-only"`, like every other module under `src/lib/data/`.
 */

interface Options {
  db?: Db;
  now?: Date;
}

/** One lock for every reservation: the budget is lab-wide. */
const LOCK_KEY = "chat-illustrations";

export type ReserveResult =
  | { ok: true; id: string }
  | { ok: false; reason: "person_limit"; used: number }
  | { ok: false; reason: "lab_budget"; spentUsd: number };

/**
 * Take a place for one illustration, or say which cap refuses it. Under a
 * transaction-scoped advisory lock, so two requests at once cannot both take
 * the last place or the last cents. The row is inserted `pending` with
 * `estimatedCostUsd`, which counts against the budget until the call settles.
 */
export async function reserveIllustration(
  input: {
    userId: string;
    kind: IllustrationKind;
    model: string;
    estimatedCostUsd: number;
    perPersonLimit: number;
    labBudgetUsd: number;
    windowMs: number;
  },
  options: Options = {}
): Promise<ReserveResult> {
  const db = options.db ?? (await getDb());
  const since = new Date((options.now ?? new Date()).getTime() - input.windowMs);
  return db.transaction(async (tx): Promise<ReserveResult> => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${LOCK_KEY}))`);
    const [mine] = await tx
      .select({ n: count() })
      .from(chatIllustrations)
      .where(
        and(
          eq(chatIllustrations.userId, input.userId),
          gte(chatIllustrations.createdAt, since),
          inArray(chatIllustrations.status, ["pending", "ready"])
        )
      );
    const used = Number(mine?.n ?? 0);
    if (used >= input.perPersonLimit) return { ok: false, reason: "person_limit", used };

    const [lab] = await tx
      .select({ total: sum(chatIllustrations.costUsd) })
      .from(chatIllustrations)
      .where(gte(chatIllustrations.createdAt, since));
    const spentUsd = Number(lab?.total ?? 0);
    if (spentUsd + input.estimatedCostUsd > input.labBudgetUsd) return { ok: false, reason: "lab_budget", spentUsd };

    const [row] = await tx
      .insert(chatIllustrations)
      .values({
        userId: input.userId,
        kind: input.kind,
        model: input.model,
        costUsd: input.estimatedCostUsd,
        status: "pending",
      })
      .returning({ id: chatIllustrations.id });
    return { ok: true, id: row.id };
  });
}

/** The picture is stored: `ready`, with what it cost. */
export async function finishIllustration(
  id: string,
  done: { blobPathname: string; contentType: string; width: number; height: number; costUsd: number },
  options: Options = {}
): Promise<void> {
  const db = options.db ?? (await getDb());
  await db
    .update(chatIllustrations)
    .set({ ...done, status: "ready", finishedAt: sql`now()` })
    .where(eq(chatIllustrations.id, id));
}

/**
 * No picture came of it: `failed`. `costUsd` is what the Gateway reported for
 * a call that answered (an image that was then refused still cost that), else
 * 0 — a call that errored is not charged.
 */
export async function failIllustration(id: string, costUsd = 0, options: Options = {}): Promise<void> {
  const db = options.db ?? (await getDb());
  await db
    .update(chatIllustrations)
    .set({ status: "failed", costUsd, finishedAt: sql`now()` })
    .where(eq(chatIllustrations.id, id));
}

/** A stored illustration as the image route serves it. */
export interface ReadyIllustration {
  id: string;
  blobPathname: string;
  contentType: string | null;
}

/**
 * `id`'s picture, only for the person who asked for it and only once it is
 * stored. Null for anything else — another person's, a pending or failed
 * one, or an id that is not uuid-shaped.
 */
export async function findReadyIllustration(
  id: string,
  userId: string,
  options: Options = {}
): Promise<ReadyIllustration | null> {
  if (!isUuid(id)) return null;
  const db = options.db ?? (await getDb());
  const [row] = await db
    .select({
      id: chatIllustrations.id,
      blobPathname: chatIllustrations.blobPathname,
      contentType: chatIllustrations.contentType,
    })
    .from(chatIllustrations)
    .where(and(eq(chatIllustrations.id, id), eq(chatIllustrations.userId, userId), eq(chatIllustrations.status, "ready")));
  if (!row?.blobPathname) return null;
  return { id: row.id, blobPathname: row.blobPathname, contentType: row.contentType };
}
