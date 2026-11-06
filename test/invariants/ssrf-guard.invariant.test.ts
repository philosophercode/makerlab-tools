import { fc, RUNS } from "./fc";
import { isForbiddenAddress } from "@/lib/web/address-guard";

/**
 * INVARIANT 11 — the server never fetches a private, loopback or metadata address.
 *
 * `read_page` and research fetch URLs a model proposed; every address a host
 * resolves to passes `isForbiddenAddress` on every redirect hop. For any
 * address inside a forbidden range — in any IPv4-inside-IPv6 spelling too —
 * the answer is "forbidden"; for anything that is not an IP at all, also
 * "forbidden"; and ordinary public addresses stay fetchable (not vacuous).
 */

const FORBIDDEN_V4: [number[], number][] = [
  [[0, 0, 0, 0], 8],
  [[10, 0, 0, 0], 8],
  [[100, 64, 0, 0], 10],
  [[127, 0, 0, 0], 8],
  [[169, 254, 0, 0], 16],
  [[172, 16, 0, 0], 12],
  [[192, 0, 0, 0], 24],
  [[192, 168, 0, 0], 16],
  [[198, 18, 0, 0], 15],
  [[224, 0, 0, 0], 4],
  [[240, 0, 0, 0], 4],
];

const toNum = (o: number[]) => o.reduce((a, b) => a * 256 + b, 0);
const toQuad = (n: number) => [24, 16, 8, 0].map((s) => Math.floor(n / 2 ** s) % 256).join(".");

/** A random address inside one of the forbidden IPv4 ranges. */
const forbiddenV4 = fc
  .constantFrom(...FORBIDDEN_V4)
  .chain(([base, bits]) => fc.nat({ max: 2 ** (32 - bits) - 1 }).map((offset) => toQuad(toNum(base) + offset)));

/** Public IPv4: well-known unicast ranges nowhere near a forbidden one. */
const publicV4 = fc.tuple(fc.constantFrom(1, 8, 9, 23, 52, 104, 142, 151, 185), fc.nat(255), fc.nat(255), fc.integer({ min: 1, max: 254 })).map((o) => o.join("."));

const hex16 = fc.nat(0xffff).map((n) => n.toString(16));
const v6Tail = fc.array(hex16, { minLength: 7, maxLength: 7 });

const quadToWords = (quad: string) => {
  const n = toNum(quad.split(".").map(Number));
  return [Math.floor(n / 65536).toString(16), (n % 65536).toString(16)];
};

/** Forbidden IPv6: link-local, unique-local, multicast, and IPv4 embedded every way. */
const forbiddenV6 = fc.oneof(
  v6Tail.map((t) => [((0xfe80 | (Number.parseInt(t[0], 16) & 0x3f))).toString(16), ...t.slice(1), "1"].join(":")),
  v6Tail.map((t) => [(0xfc00 | (Number.parseInt(t[0], 16) & 0x1ff)).toString(16), ...t.slice(1), "1"].join(":")),
  v6Tail.map((t) => ["ff" + (Number.parseInt(t[0], 16) & 0xff).toString(16).padStart(2, "0"), ...t.slice(1), "1"].join(":")),
  forbiddenV4.map((q) => `::ffff:${q}`),
  forbiddenV4.map((q) => `::ffff:${quadToWords(q).join(":")}`),
  forbiddenV4.map((q) => `64:ff9b::${q}`),
  forbiddenV4.map((q) => `2002:${quadToWords(q).join(":")}::1`),
  fc.constantFrom("::", "::1", "[::1]", "fd00:ec2::254", "0:0:0:0:0:0:0:1")
);

describe("invariant: forbidden addresses are never fetched", () => {
  it("every address in a forbidden IPv4 range is refused", () => {
    fc.assert(fc.property(forbiddenV4, (ip) => {
        expect(isForbiddenAddress(ip), ip).toBe(true);
      }), { numRuns: RUNS });
  });

  it("every forbidden IPv6 spelling is refused, including IPv4 embedded in it", () => {
    fc.assert(fc.property(forbiddenV6, (ip) => {
        expect(isForbiddenAddress(ip), ip).toBe(true);
      }), { numRuns: RUNS });
  });

  it("anything that is not an IP address is refused", () => {
    fc.assert(
      fc.property(
        fc.oneof(fc.string(), fc.domain(), fc.webUrl(), publicV4.map((ip) => `${ip}.`), publicV4.map((ip) => `${ip}:80`)),
        (text) => {
          const looksLikeIp = /^[\d.]+$|^[0-9a-f:]+$/i.test(text.trim()) && text.trim().length > 0;
          if (!looksLikeIp) expect(isForbiddenAddress(text), text).toBe(true);
        }
      ),
      { numRuns: RUNS }
    );
  });

  it("public addresses stay fetchable (so the rule is not 'refuse everything')", () => {
    fc.assert(
      fc.property(fc.oneof(publicV4, publicV4.map((q) => `::ffff:${q}`)), (ip) => {
        expect(isForbiddenAddress(ip), ip).toBe(false);
      }),
      { numRuns: RUNS }
    );
  });
});
