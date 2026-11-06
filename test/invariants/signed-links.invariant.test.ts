import { randomUUID } from "node:crypto";
import { fc, IO_RUNS, RUNS } from "./fc";
import { signDemoPass, verifyDemoPass } from "@/lib/demo-pass/token";
import { NOTIFICATION_EVENTS } from "@/lib/notifications/events";
import { signUnsubscribeToken, verifyUnsubscribeToken } from "@/lib/notifications/unsubscribe";

/**
 * INVARIANT 14 — signed links and cookies only mean what was signed.
 *
 * The email unsubscribe link and the demo pass cookie are HMAC-signed claims
 * a stranger can copy, edit or invent. For either one: what was signed
 * verifies back to exactly that claim; any edit to it, any other secret, and
 * any string at all that was not signed verifies to nothing.
 */

const SECRET = "signed-links-invariant-secret";

/** One character changed, inserted or removed somewhere in `token`. */
const tampered = (token: string) =>
  fc
    .tuple(fc.nat({ max: token.length - 1 }), fc.constantFrom("flip", "drop", "insert"), fc.constantFrom("A", "b", "0", "-", "_", "."))
    .map(([i, op, ch]) => {
      if (op === "flip") return token.slice(0, i) + (token[i] === ch ? "Z" : ch) + token.slice(i + 1);
      if (op === "drop") return token.slice(0, i) + token.slice(i + 1);
      return token.slice(0, i) + ch + token.slice(i);
    })
    .filter((t) => canonical(t) !== canonical(token));

/**
 * A 32-byte HMAC in base64url is 43 characters, and the last one carries two
 * unused bits: "…u_" and "…u-" can be the same signature. Compare what the
 * signature decodes to, so an edit that changes only those bits is not counted
 * as a forgery.
 */
function canonical(token: string): string {
  const dot = token.lastIndexOf(".");
  const sig = token.slice(dot + 1);
  if (dot < 0 || !/^[A-Za-z0-9_-]+$/.test(sig)) return token;
  return `${token.slice(0, dot)}.${Buffer.from(sig, "base64url").toString("hex")}`;
}

describe("invariant: unsubscribe links verify only as signed", () => {
  const claim = fc.record({
    userId: fc.stringMatching(/^[a-zA-Z0-9-]{1,40}$/),
    event: fc.constantFrom(...NOTIFICATION_EVENTS),
    issuedAt: fc.integer({ min: 0, max: 2_000_000_000 }),
  });

  it("round-trips, and nothing else verifies", () => {
    fc.assert(
      fc.property(claim, fc.string({ minLength: 1, maxLength: 40 }), (c, otherSecret) => {
        const token = signUnsubscribeToken(c, SECRET)!;
        expect(verifyUnsubscribeToken(token, SECRET)).toEqual(c);
        if (otherSecret !== SECRET) expect(verifyUnsubscribeToken(token, otherSecret)).toBeNull();
        fc.assert(
          fc.property(tampered(token), (t) => {
            expect(verifyUnsubscribeToken(t, SECRET)).toBeNull();
          }),
          { numRuns: 20 }
        );
      }),
      { numRuns: RUNS / 4 }
    );
  });

  it("an arbitrary string never verifies", () => {
    fc.assert(
      fc.property(fc.oneof(fc.string(), fc.string().map((s) => `v1.${s}.${s}`)), (t) => {
        expect(verifyUnsubscribeToken(t, SECRET)).toBeNull();
      }),
      { numRuns: RUNS }
    );
  });
});

describe("invariant: demo pass cookies verify only as signed", () => {
  const future = fc.integer({ min: 60, max: 30 * 86_400 }).map((s) => new Date(Date.now() + s * 1000));

  it("round-trips, and edits, other secrets and expired passes never verify", async () => {
    await fc.assert(
      fc.asyncProperty(future, fc.string({ minLength: 1, maxLength: 40 }), async (expiresAt, otherSecret) => {
        const passId = randomUUID();
        const value = await signDemoPass({ passId, expiresAt }, SECRET);
        expect(value).not.toBeNull();
        const back = await verifyDemoPass(value, SECRET);
        expect(back?.passId).toBe(passId);
        if (otherSecret !== SECRET) expect(await verifyDemoPass(value, otherSecret)).toBeNull();
        expect(await verifyDemoPass(value, SECRET, new Date(expiresAt.getTime() + 1000))).toBeNull();
        const edits = fc.sample(tampered(value!), 15);
        for (const edit of edits) expect(await verifyDemoPass(edit, SECRET), edit).toBeNull();
      }),
      { numRuns: IO_RUNS }
    );
  });

  it("an arbitrary string never verifies", async () => {
    await fc.assert(
      fc.asyncProperty(fc.oneof(fc.string(), fc.uuid().map((u) => `v1.${u}.9999999999.${"A".repeat(43)}`)), async (t) => {
        expect(await verifyDemoPass(t, SECRET)).toBeNull();
      }),
      { numRuns: RUNS }
    );
  });
});
