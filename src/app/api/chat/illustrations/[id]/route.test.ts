// @vitest-environment node
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../../../test/utils/session";

/** A one-shot "the limiter says no". */
const rateLimitOverride = vi.hoisted(() => ({ denyOnce: false }));

vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: async (
      scope: Parameters<typeof actual.checkRateLimit>[0],
      identity: Parameters<typeof actual.checkRateLimit>[1]
    ) => {
      if (rateLimitOverride.denyOnce) {
        rateLimitOverride.denyOnce = false;
        return { allowed: false, remaining: 0, limit: 60, windowMs: 60_000, retryAfterSeconds: 60, role: identity.role };
      }
      return actual.checkRateLimit(scope, identity);
    },
  };
});

// The Blob seam, stubbed: `read` answers whatever bytes the test stored.
const blob = vi.hoisted(() => ({
  configured: true,
  files: new Map<string, { access: "public" | "private"; bytes: Uint8Array }>(),
  read: vi.fn(),
}));

vi.mock("@/lib/blob", () => ({
  isBlobConfigured: () => blob.configured,
  getBlobStore: () => ({ read: blob.read }),
}));

import { getDb, resetDbForTests } from "@/lib/db/client";
import { chatIllustrations } from "@/lib/db/schema/index";
import { GET } from "./route";

/**
 * `GET /api/chat/illustrations/[id]` (gateway spec amendment 2026-10-07)
 * against the demo PGlite database with the Blob seam stubbed: a made
 * illustration to the person who asked for it, uncached, and the same 404 for
 * everything else.
 */

const AUTH_SECRET = "illustration-route-test-secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 9, 9]);

let casey: Awaited<ReturnType<typeof signInAsNew>>;
let robin: Awaited<ReturnType<typeof signInAsNew>>;
let counter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  rateLimitOverride.denyOnce = false;
  blob.configured = true;
  blob.files.clear();
  blob.read.mockReset().mockImplementation(async (pathname: string, access = "private") => {
    const file = blob.files.get(pathname);
    return file && file.access === access ? { body: file.bytes, contentType: "image/png" } : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  counter += 1;
  casey = await signInAsNew({ email: `ill-casey-${counter}@cornell.edu`, role: "user" });
  robin = await signInAsNew({ email: `ill-robin-${counter}@cornell.edu`, role: "admin" });
  const db = await getDb();
  await db.delete(chatIllustrations);
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

async function illustration(userId: string, status: "pending" | "ready" | "failed" = "ready") {
  const db = await getDb();
  const pathname = `chat/illustrations/${crypto.randomUUID()}.png`;
  const [row] = await db
    .insert(chatIllustrations)
    .values({
      userId,
      kind: "plan",
      model: "recraft/recraft-v4.1-flash",
      costUsd: 0.007,
      status,
      blobPathname: status === "ready" ? pathname : null,
      contentType: status === "ready" ? "image/png" : null,
    })
    .returning({ id: chatIllustrations.id });
  blob.files.set(pathname, { access: "private", bytes: PNG });
  return { id: row.id, pathname };
}

let ip = 0;
function get(id: string, cookie: string | null) {
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.0.${ip}` };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/chat/illustrations/${id}`, { headers });
  return GET(req as never, { params: Promise.resolve({ id }) });
}

describe("GET /api/chat/illustrations/[id]", () => {
  it("serves a made illustration to the person who asked for it, from the private store, uncached", async () => {
    const { id, pathname } = await illustration(casey.user.id);
    const res = await get(id, casey.cookie);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(blob.read).toHaveBeenCalledExactlyOnceWith(pathname, "private");
  });

  it("answers 401 to an anonymous caller before reading anything", async () => {
    const { id } = await illustration(casey.user.id);
    expect((await get(id, null)).status).toBe(401);
    expect(blob.read).not.toHaveBeenCalled();
  });

  it("answers the same 404 for somebody else's, staff included, and for a pending, failed or malformed one", async () => {
    const mine = await illustration(casey.user.id);
    expect((await get(mine.id, robin.cookie)).status).toBe(404);
    expect((await get((await illustration(casey.user.id, "pending")).id, casey.cookie)).status).toBe(404);
    expect((await get((await illustration(casey.user.id, "failed")).id, casey.cookie)).status).toBe(404);
    expect((await get("not-a-uuid", casey.cookie)).status).toBe(404);
    expect((await get(crypto.randomUUID(), casey.cookie)).status).toBe(404);
  });

  it("answers 404 without a Blob store, and when the blob is gone", async () => {
    const { id, pathname } = await illustration(casey.user.id);
    blob.configured = false;
    expect((await get(id, casey.cookie)).status).toBe(404);
    blob.configured = true;
    blob.files.delete(pathname);
    expect((await get(id, casey.cookie)).status).toBe(404);
  });

  it("is rate-limited before anything is read", async () => {
    const { id } = await illustration(casey.user.id);
    rateLimitOverride.denyOnce = true;
    const res = await get(id, casey.cookie);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(blob.read).not.toHaveBeenCalled();
  });
});
