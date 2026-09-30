// @vitest-environment node
import { eq } from "drizzle-orm";
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../../test/utils/session";

/**
 * Withhold or grant one permission, to prove "not the owner" is a real
 * refusal and not one every `tools.add` role happens to clear anyway.
 *
 * No role that holds `tools.add` fails to also hold `tools.approve`
 * (`permissions.ts`), so the only way to see `canActOnPendingTool`'s two
 * checks disagree — owner vs. approver — is to take the declaration out of
 * the picture for one test (the `admin/maintenance` actions test idiom). Null
 * means the real `can()`, so every other test runs against the genuine
 * article.
 */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));

vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/**
 * A single-shot "the limiter says no", so one test can prove the 429 path
 * without spending real requests against `ROUTE_TIERS.pendingTools` (60/min —
 * high enough that exhausting it for real would slow every run of this file).
 */
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
        return {
          allowed: false,
          remaining: 0,
          limit: 60,
          windowMs: 60_000,
          retryAfterSeconds: 60,
          role: identity.role,
        };
      }
      return actual.checkRateLimit(scope, identity);
    },
  };
});

import { getDb, resetDbForTests } from "@/lib/db/client";
import { attachments, pendingTools, tools } from "@/lib/db/schema/index";
import { createPendingBatch } from "@/lib/data/pending-tools";
import { PATCH } from "./route";

/**
 * `PATCH /api/pending-tools/[id]` against the demo-seeded PGlite database
 * (spec §4.10, §5.4 step 5, §8, §10 "permission and ownership"). No
 * environment variable is real and nothing leaves the process.
 */

const AUTH_SECRET = "pending-tools-id-route-test-secret";

let ownerSession: Awaited<ReturnType<typeof signInAsNew>>;
let approverSession: Awaited<ReturnType<typeof signInAsNew>>;
let userSession: Awaited<ReturnType<typeof signInAsNew>>;
let formFourId = "";
let sessionCounter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  override.permissions = null;
  rateLimitOverride.denyOnce = false;

  sessionCounter += 1;
  // `tools.add` — the permission `canActOnPendingTool` always requires — is
  // only ever granted to `admin` and `super_admin` (permissions.ts), so
  // "owner" and "approver" here have to be one of those two.
  ownerSession = await signInAsNew({
    email: `pt-owner-${sessionCounter}@cornell.edu`,
    name: "Owner",
    role: "admin",
  });
  approverSession = await signInAsNew({
    email: `pt-approver-${sessionCounter}@cornell.edu`,
    name: "Approver",
    role: "admin",
  });
  userSession = await signInAsNew({
    email: `pt-user-${sessionCounter}@cornell.edu`,
    name: "Plain User",
    role: "user",
  });

  const db = await getDb();
  await db.delete(pendingTools);
  await db.delete(attachments);
  const [tool] = await db.select({ id: tools.id }).from(tools).where(eq(tools.slug, "form-4"));
  formFourId = tool.id;
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

// ── Helpers ─────────────────────────────────────────────────────────

// The in-memory limiter is a per-process singleton keyed by `pendingTools:<ip>`.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.4.0.${ipCounter}`;
}

interface RequestOptions {
  cookie?: string | null;
  ip?: string;
  raw?: string;
}

function patchRequest(id: string, body: unknown, options: RequestOptions = {}) {
  const cookie = "cookie" in options ? options.cookie : ownerSession.cookie;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": options.ip ?? uniqueIp(),
  };
  if (cookie) headers.cookie = cookie;
  return new Request(`http://localhost/api/pending-tools/${id}`, {
    method: "PATCH",
    headers,
    body: options.raw ?? JSON.stringify(body),
  });
}

function patch(id: string, body: unknown, options: RequestOptions = {}) {
  return PATCH(patchRequest(id, body, options) as never, { params: Promise.resolve({ id }) });
}

async function createItem(overrides: { name?: string; createdBy?: string } = {}) {
  const batch = await createPendingBatch({
    createdBy: overrides.createdBy ?? ownerSession.user.id,
    items: [{ name: overrides.name ?? "Random Widget 9000" }],
  });
  return batch.items[0].id;
}

async function markQueued(id: string) {
  const db = await getDb();
  await db.update(pendingTools).set({ status: "queued" }).where(eq(pendingTools.id, id));
}

async function uploadPhoto(ownerId: string) {
  const db = await getDb();
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/tool/${crypto.randomUUID()}.png`,
      access: "public",
      publicUrl: `https://blob.test/${crypto.randomUUID()}.png`,
      ownerType: "pending_tool",
      ownerId,
    })
    .returning({ id: attachments.id });
  return row.id;
}

async function storedItem(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(pendingTools).where(eq(pendingTools.id, id));
  return row;
}

// ── Sign-in and permission gates ────────────────────────────────────

describe("PATCH /api/pending-tools/[id] (sign-in and permission gates)", () => {
  it("answers 401 to an anonymous request", async () => {
    const id = await createItem();
    const res = await patch(id, { name: "New Name" }, { cookie: null });

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("sign_in_required");
    expect((await storedItem(id)).name).not.toBe("New Name");
  });

  it("answers 403 to a plain `user` role — it never holds tools.add", async () => {
    const id = await createItem();
    const res = await patch(id, { name: "New Name" }, { cookie: userSession.cookie });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  it("answers 403 for a non-owner once tools.approve is withheld", async () => {
    const id = await createItem({ createdBy: ownerSession.user.id });
    // Every admin holds both tools.add and tools.approve for real, so the only
    // way to isolate "owner" from "approver" is this mock.
    override.permissions = new Set(["tools.add"]);

    const res = await patch(id, { name: "New Name" }, { cookie: approverSession.cookie });

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
  });

  it("answers 200 for the item's own creator", async () => {
    const id = await createItem({ createdBy: ownerSession.user.id });

    const res = await patch(id, { name: "New Name" }, { cookie: ownerSession.cookie });

    expect(res.status).toBe(200);
  });

  it("answers 200 for an approver who is not the owner", async () => {
    const id = await createItem({ createdBy: ownerSession.user.id });

    const res = await patch(id, { name: "New Name" }, { cookie: approverSession.cookie });

    expect(res.status).toBe(200);
  });
});

// ── Not found ────────────────────────────────────────────────────────

describe("PATCH /api/pending-tools/[id] (not found)", () => {
  it("answers 404 for a missing uuid", async () => {
    const res = await patch(crypto.randomUUID(), { name: "New Name" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });

  it("answers 404 for an id that is not uuid-shaped", async () => {
    const res = await patch("not-a-uuid", { name: "New Name" });
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("not_found");
  });
});

// ── Body validation ──────────────────────────────────────────────────

describe("PATCH /api/pending-tools/[id] (body validation)", () => {
  it("answers 400 for an empty body", async () => {
    const id = await createItem();
    const res = await patch(id, {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("answers 400 for an unknown key", async () => {
    const id = await createItem();
    const res = await patch(id, { name: "New Name", nonsense: true });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("answers 400 for a blank name", async () => {
    const id = await createItem();
    const res = await patch(id, { name: "   " });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("answers 400 for a name over 200 characters", async () => {
    const id = await createItem();
    const res = await patch(id, { name: "x".repeat(201) });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });

  it("answers 400 for malformed JSON", async () => {
    const id = await createItem();
    const res = await patch(id, null, { raw: "{not json" });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid_body");
  });
});

// ── Editing ──────────────────────────────────────────────────────────

describe("PATCH /api/pending-tools/[id] (editing)", () => {
  it("renames the item and re-runs the duplicate check", async () => {
    const id = await createItem({ name: "Some Unrelated Gadget" });

    const res = await patch(id, { name: "Form 4" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.name).toBe("Form 4");
    expect(body.item.duplicateOf).toMatchObject({ kind: "tool", id: formFourId, name: "Form 4" });
  });

  it("accepts add_unit with a serial number once a tool is matched", async () => {
    // Named exactly like the catalogue tool, so `createPendingBatch` matches
    // it as a duplicate at creation time.
    const id = await createItem({ name: "Form 4" });

    const res = await patch(id, { duplicateResolution: "add_unit", serialNumber: "SN-42" });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.duplicateResolution).toBe("add_unit");
    expect(body.item.serialNumber).toBe("SN-42");
  });

  it("refuses add_unit with 422 when nothing matched", async () => {
    const id = await createItem({ name: "Zzyxq Widget 12345" });

    const res = await patch(id, { duplicateResolution: "add_unit" });

    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("invalid_field");
  });

  it("discards the item and releases its photos", async () => {
    const id = await createItem();
    const photoId = await uploadPhoto(id);

    const res = await patch(id, { discard: true });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.item.status).toBe("discarded");

    const db = await getDb();
    const [photo] = await db.select().from(attachments).where(eq(attachments.id, photoId));
    expect(photo.ownerId).toBeNull();
    expect(photo.ownerType).toBeNull();
  });

  it("answers 409 for an item that is no longer editable", async () => {
    const id = await createItem();
    await markQueued(id);

    const res = await patch(id, { name: "New Name" });

    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not_editable");
  });
});

// ── Rate limiting ────────────────────────────────────────────────────

describe("PATCH /api/pending-tools/[id] (rate limiting)", () => {
  it("answers 429 with Retry-After once the limiter says no", async () => {
    const id = await createItem();
    rateLimitOverride.denyOnce = true;

    const res = await patch(id, { name: "New Name" });

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).code).toBe("rate_limited");
    expect((await storedItem(id)).name).not.toBe("New Name");
  });
});
