// @vitest-environment node
import { fc, RUNS } from "./fc";
import { anonymousIdentity, hashIp } from "@/lib/auth/identity";

/**
 * INVARIANT 20 — an anonymous visitor's IP address is never stored or keyed raw.
 *
 * Rate limits for people who are not signed in are keyed by a *hash* of the
 * client IP (AGENTS.md: "hashed IP when not"), and that key is what reaches
 * the limiter, Upstash and the logs. For any IPv4 or IPv6 address, in any
 * forwarding header: the key never contains the address; the same address
 * always gets the same key (so the limit still bites); different addresses
 * get different keys; the hash is salted with the deployment's secret, so a
 * table of hashed addresses from elsewhere cannot reverse it; and the identity
 * holds nothing else about the person.
 */

const ip = fc.oneof(fc.ipV4(), fc.ipV6());

function request(header: "x-forwarded-for" | "x-real-ip", value: string): Request {
  return new Request("https://makerlab.example/", { headers: { [header]: value } });
}

describe("invariant: anonymous keys never hold the raw IP", () => {
  it("hashes the address, deterministically and distinctly", async () => {
    await fc.assert(
      fc.asyncProperty(ip, ip, fc.constantFrom("x-forwarded-for" as const, "x-real-ip" as const), async (a, b, header) => {
        const first = await anonymousIdentity(request(header, a));
        const again = await anonymousIdentity(request("x-forwarded-for", `${a}, 10.0.0.1`));
        const other = await anonymousIdentity(request(header, b));

        expect(first.role).toBe("anonymous");
        expect([first.userId, first.email, first.name]).toEqual([null, null, null]);
        expect(first.rateLimitKey.includes(a), first.rateLimitKey).toBe(false);
        expect(first.rateLimitKey).toMatch(/^ip:[A-Za-z0-9_-]{16,}$/);
        expect(again.rateLimitKey).toBe(first.rateLimitKey);
        if (a !== b) expect(other.rateLimitKey).not.toBe(first.rateLimitKey);
      }),
      { numRuns: RUNS }
    );
  });

  it("is salted: the same address under another secret hashes differently", async () => {
    await fc.assert(
      fc.asyncProperty(ip, fc.string({ minLength: 8, maxLength: 40 }), fc.string({ minLength: 8, maxLength: 40 }), async (a, s1, s2) => {
        if (s1 === s2) return;
        expect(await hashIp(a, s1)).not.toBe(await hashIp(a, s2));
      }),
      { numRuns: RUNS }
    );
  });
});
