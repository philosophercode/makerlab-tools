// @vitest-environment node
import { fc, IO_RUNS } from "./fc";
import { createApiToken, listApiTokens, revokeApiToken } from "@/lib/data/api-tokens";
import { finishIllustration, findReadyIllustration, reserveIllustration } from "@/lib/data/chat-illustrations";
import { createPgliteDb } from "@/lib/db/pglite";
import type { Db } from "@/lib/db/types";
import { insertUserRow } from "../utils/session";

/**
 * INVARIANT 7 — one person can never read or change another person's data.
 *
 * A random interleaving of several people creating MCP access tokens,
 * revoking tokens (their own, or ids copied from someone else), and making
 * chat illustrations, checked against a model after every step:
 *
 * - Each person's token list is exactly the tokens they created — nobody
 *   else's, none missing.
 * - Revoking another person's token id answers `not_found` and changes nothing.
 * - An illustration is served only to the person who asked for it.
 *
 * The per-person data with an owner column all goes through `where userId =`;
 * this is the property that says so, whatever order things happen in.
 */

let db: Db;

beforeAll(async () => {
  db = await createPgliteDb();
}, 30_000);

type Step =
  | { op: "create"; who: number; readOnly: boolean }
  | { op: "revoke"; who: number; pick: number }
  | { op: "illustrate"; who: number };

const PEOPLE = 3;
const who = fc.nat({ max: PEOPLE - 1 });
const step: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ op: fc.constant("create" as const), who, readOnly: fc.boolean() }),
  fc.record({ op: fc.constant("revoke" as const), who, pick: fc.nat() }),
  fc.record({ op: fc.constant("illustrate" as const), who })
);

describe("invariant: per-person data stays with its owner", () => {
  it("tokens and illustrations never cross between people", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 12 }), async (steps) => {
        const people = await Promise.all(Array.from({ length: PEOPLE }, () => insertUserRow(db)));
        const tokens = people.map(() => new Map<string, { revoked: boolean }>());
        const allTokens: { id: string; owner: number }[] = [];
        const illustrations: { id: string; owner: number }[] = [];

        for (const s of steps) {
          const person = people[s.who];
          if (s.op === "create") {
            const made = await createApiToken({ userId: person.id, name: "invariant", readOnly: s.readOnly }, { db });
            if (made.ok) {
              tokens[s.who].set(made.summary.id, { revoked: false });
              allTokens.push({ id: made.summary.id, owner: s.who });
            }
          } else if (s.op === "revoke" && allTokens.length > 0) {
            const target = allTokens[s.pick % allTokens.length];
            const result = await revokeApiToken(person.id, target.id, { db });
            if (target.owner !== s.who) {
              expect(result).toEqual({ ok: false, reason: "not_found" });
            } else {
              const was = tokens[s.who].get(target.id)!;
              expect(result.ok).toBe(!was.revoked);
              was.revoked = true;
            }
          } else if (s.op === "illustrate") {
            const reserved = await reserveIllustration(
              {
                userId: person.id,
                kind: "plan",
                model: "stub",
                estimatedCostUsd: 0,
                perPersonLimit: 1_000,
                labBudgetUsd: 1_000,
                windowMs: 60_000,
              },
              { db }
            );
            if (reserved.ok) {
              await finishIllustration(
                reserved.id,
                { blobPathname: `illustrations/${reserved.id}.png`, contentType: "image/png", width: 1, height: 1, costUsd: 0 },
                { db }
              );
              illustrations.push({ id: reserved.id, owner: s.who });
            }
          }

          // After every step: each list is exactly its owner's.
          for (let i = 0; i < PEOPLE; i++) {
            const listed = await listApiTokens(people[i].id, { db });
            expect(new Set(listed.map((t) => t.id))).toEqual(new Set(tokens[i].keys()));
            for (const t of listed) expect(t.revokedAt !== null).toBe(tokens[i].get(t.id)!.revoked);
          }
        }

        for (const ill of illustrations) {
          for (let i = 0; i < PEOPLE; i++) {
            const found = await findReadyIllustration(ill.id, people[i].id, { db });
            if (i === ill.owner) expect(found?.id).toBe(ill.id);
            else expect(found).toBeNull();
          }
        }
      }),
      { numRuns: IO_RUNS }
    );
  }, 60_000);
});
