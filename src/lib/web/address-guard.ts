import { isIP } from "node:net";

/**
 * Which IP addresses the server must never fetch (gateway spec §3.3, §8 SSRF).
 *
 * The server now reads the bodies of URLs a model proposed, so a page that
 * says "see http://169.254.169.254/latest/meta-data/" must not become a request
 * to the cloud metadata service. Every address a host resolves to is checked
 * here, on every redirect hop, before any byte is requested.
 *
 * Refused:
 *
 * - IPv4: `0.0.0.0/8`, `10/8`, `100.64/10` (CGNAT, which also holds Alibaba's
 *   metadata `100.100.100.200`), `127/8`, `169.254/16` (link-local, including
 *   `169.254.169.254`), `172.16/12`, `192.0.0/24`, `192.168/16`, `198.18/15`,
 *   multicast `224/4`, and `240/4` up to the broadcast address.
 * - IPv6: `::` and `::1`, `fe80::/10` link-local, `fc00::/7` unique-local (which
 *   holds AWS's `fd00:ec2::254`), `ff00::/8` multicast, and every form that
 *   embeds an IPv4 address — mapped `::ffff:0:0/96`, compatible `::/96`, NAT64
 *   `64:ff9b::/96` and 6to4 `2002::/16` — judged by the IPv4 address inside.
 * - Anything that does not parse as an IP address at all.
 *
 * A hand-written parser rather than `net.BlockList`, so the IPv4-inside-IPv6
 * rules are explicit and the same on every Node version.
 */
export function isForbiddenAddress(ip: string): boolean {
  const address = ip.trim().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const version = isIP(address);
  if (version === 4) return isForbiddenV4(parseV4(address));
  if (version === 6) {
    const words = parseV6(address);
    return words === null ? true : isForbiddenV6(words);
  }
  return true;
}

/** [base, prefix length] pairs, as 32-bit numbers. */
const FORBIDDEN_V4: readonly [number, number][] = [
  [v4("0.0.0.0"), 8],
  [v4("10.0.0.0"), 8],
  [v4("100.64.0.0"), 10],
  [v4("127.0.0.0"), 8],
  [v4("169.254.0.0"), 16],
  [v4("172.16.0.0"), 12],
  [v4("192.0.0.0"), 24],
  [v4("192.168.0.0"), 16],
  [v4("198.18.0.0"), 15],
  [v4("224.0.0.0"), 4],
  [v4("240.0.0.0"), 4],
];

function v4(text: string): number {
  return parseV4(text);
}

function parseV4(text: string): number {
  return text.split(".").reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

function inPrefix(address: number, base: number, bits: number): boolean {
  const size = 2 ** (32 - bits);
  return Math.floor(address / size) === Math.floor(base / size);
}

function isForbiddenV4(address: number): boolean {
  return FORBIDDEN_V4.some(([base, bits]) => inPrefix(address, base, bits));
}

/** Eight 16-bit words, or null when the text is not a well-formed IPv6 address. */
function parseV6(text: string): number[] | null {
  let head = text;
  const tail: number[] = [];

  // A trailing dotted quad is two words.
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(head);
  if (dotted) {
    if (isIP(dotted[1]) !== 4) return null;
    const value = parseV4(dotted[1]);
    tail.push(Math.floor(value / 65536), value % 65536);
    head = head.slice(0, -dotted[1].length);
    if (head.endsWith(":") && !head.endsWith("::")) head = head.slice(0, -1);
  }

  const halves = head.split("::");
  if (halves.length > 2) return null;
  const words = (part: string) => (part === "" ? [] : part.split(":").map((w) => parseInt(w, 16)));
  const left = words(halves[0]);
  const right = halves.length === 2 ? words(halves[1]) : [];
  const given = left.length + right.length + tail.length;
  if (left.concat(right).some((w) => !Number.isInteger(w) || w < 0 || w > 0xffff)) return null;

  if (halves.length === 1) return given === 8 ? [...left, ...tail] : null;
  if (given > 7) return null;
  return [...left, ...new Array<number>(8 - given).fill(0), ...right, ...tail];
}

function embeddedV4(high: number, low: number): number {
  return high * 65536 + low;
}

function isForbiddenV6(w: number[]): boolean {
  const zeroUpTo = (n: number) => w.slice(0, n).every((word) => word === 0);

  // :: and ::1
  if (zeroUpTo(7) && (w[7] === 0 || w[7] === 1)) return true;
  // IPv4-mapped ::ffff:a.b.c.d and IPv4-compatible ::a.b.c.d
  if (zeroUpTo(5) && (w[5] === 0xffff || w[5] === 0)) return isForbiddenV4(embeddedV4(w[6], w[7]));
  // NAT64 64:ff9b::a.b.c.d
  if (w[0] === 0x64 && w[1] === 0xff9b && w.slice(2, 6).every((x) => x === 0)) {
    return isForbiddenV4(embeddedV4(w[6], w[7]));
  }
  // 6to4 2002:aabb:ccdd::
  if (w[0] === 0x2002) return isForbiddenV4(embeddedV4(w[1], w[2]));
  // fe80::/10 link-local
  if ((w[0] & 0xffc0) === 0xfe80) return true;
  // fc00::/7 unique-local
  if ((w[0] & 0xfe00) === 0xfc00) return true;
  // ff00::/8 multicast
  if ((w[0] & 0xff00) === 0xff00) return true;
  return false;
}
