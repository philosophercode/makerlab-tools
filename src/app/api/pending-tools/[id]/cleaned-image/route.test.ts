// @vitest-environment node
import { eq } from "drizzle-orm";
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../../../test/utils/session";

/** Withhold one permission for a test — see `../route.test.ts`. Null means the real `can()`. */
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

/** A one-shot "the limiter says no", as in `../route.test.ts`. */
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
import { attachments, pendingTools } from "@/lib/db/schema/index";
import { completeResearch, createPendingBatch, markResearching, queueForResearch } from "@/lib/data/pending-tools";
import type { ResearchResult } from "@/lib/research/result";
import { GET } from "./route";

/**
 * `GET /api/pending-tools/[id]/cleaned-image` (gateway spec §6, §8) against the
 * demo-seeded PGlite database with the Blob seam stubbed. The point of the
 * route is what it will *not* serve: anything to somebody who may not review
 * intake, and any attachment but the item's own cleaned copy.
 */

const AUTH_SECRET = "cleaned-image-route-test-secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let admin: Awaited<ReturnType<typeof signInAsNew>>;
let student: Awaited<ReturnType<typeof signInAsNew>>;
let counter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  override.permissions = null;
  rateLimitOverride.denyOnce = false;
  blob.configured = true;
  blob.files.clear();
  blob.read.mockReset().mockImplementation(async (pathname: string, access = "private") => {
    const file = blob.files.get(pathname);
    return file && file.access === access ? { body: file.bytes, contentType: "image/png" } : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});

  counter += 1;
  admin = await signInAsNew({ email: `ci-admin-${counter}@cornell.edu`, role: "admin" });
  student = await signInAsNew({ email: `ci-user-${counter}@cornell.edu`, role: "user" });

  const db = await getDb();
  await db.delete(pendingTools);
  await db.delete(attachments);
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

function research(cleanedId: string | null): ResearchResult {
  return {
    canonicalName: "Bambu Lab P1S",
    description: "An enclosed FDM printer.",
    specs: [],
    materials: [],
    ppeRequired: [],
    tags: [],
    trainingRequired: null,
    useRestrictions: null,
    category: { name: "FDM", group: null, existingId: null },
    resources: [],
    droppedLinks: [],
    sourceUrls: [],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: false,
      specsFromSource: false,
      categoryOnly: false,
    },
    confidence: { level: "medium", basis: [], unknowns: [] },
    images: {
      candidates: [],
      cleaned: cleanedId ? { attachmentId: cleanedId, fromUrl: "https://images.example.com/p1s.png" } : null,
    },
  };
}

/** A researched item whose cleaned copy is stored at `research/cleaned/<n>.png`. */
async function itemWithCleaned(
  overrides: { origin?: string; owner?: "self" | "other" | "none"; recorded?: boolean } = {}
) {
  const db = await getDb();
  const batch = await createPendingBatch({
    createdBy: admin.user.id,
    items: [{ name: "Bambu Lab P1S" }, { name: "Another printer" }],
  });
  const [id, otherId] = batch.items.map((item) => item.id);
  const pathname = `research/cleaned/${crypto.randomUUID()}.png`;
  const owner = overrides.owner ?? "self";
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: pathname,
      access: "private",
      origin: overrides.origin ?? "research_image_cleaned",
      ownerType: owner === "none" ? null : "pending_tool",
      ownerId: owner === "self" ? id : owner === "other" ? otherId : null,
    })
    .returning({ id: attachments.id });
  blob.files.set(pathname, { access: "private", bytes: PNG });

  await queueForResearch([id], { requestedBy: admin.user.id });
  await markResearching(id);
  await completeResearch(id, research(overrides.recorded === false ? null : row.id));
  return { id, attachmentId: row.id, pathname };
}

let ip = 0;
function get(id: string, cookie: string | null = admin.cookie) {
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.0.${ip}` };
  if (cookie) headers.cookie = cookie;
  const req = new Request(`http://localhost/api/pending-tools/${id}/cleaned-image`, { headers });
  return GET(req as never, { params: Promise.resolve({ id }) });
}

describe("GET /api/pending-tools/[id]/cleaned-image", () => {
  it("streams the item's own cleaned PNG to a reviewer, uncached", async () => {
    const { id, pathname } = await itemWithCleaned();

    const res = await get(id);

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
    expect(blob.read).toHaveBeenCalledExactlyOnceWith(pathname, "private");
  });

  it("serves a copy an earlier, refused approval already made public", async () => {
    const { id, attachmentId, pathname } = await itemWithCleaned();
    const db = await getDb();
    await db.update(attachments).set({ access: "public" }).where(eq(attachments.id, attachmentId));
    blob.files.set(pathname, { access: "public", bytes: PNG });

    expect((await get(id)).status).toBe(200);
    expect(blob.read).toHaveBeenCalledWith(pathname, "public");
  });

  it("answers 401 to an anonymous caller and 403 to one without tools.approve, before reading anything", async () => {
    const { id } = await itemWithCleaned();

    expect((await get(id, null)).status).toBe(401);
    expect((await get(id, student.cookie)).status).toBe(403);

    // The adjacent permission is not enough.
    override.permissions = new Set(["tools.add", "tools.edit", "tools.publish"]);
    expect((await get(id)).status).toBe(403);
    expect(blob.read).not.toHaveBeenCalled();
  });

  it("answers 429 when the limiter says no", async () => {
    const { id } = await itemWithCleaned();
    rateLimitOverride.denyOnce = true;
    const res = await get(id);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
  });

  it.each([
    ["owned by another item", { owner: "other" as const }],
    ["released to nobody", { owner: "none" as const }],
    ["an upload, not a cleaned copy", { origin: "upload" }],
    ["not recorded by research", { recorded: false }],
  ])("is a 404 for an attachment %s", async (_label, overrides) => {
    const { id } = await itemWithCleaned(overrides);
    expect((await get(id)).status).toBe(404);
    expect(blob.read).not.toHaveBeenCalled();
  });

  it("is a 404 for an item that does not exist, or an id that is not one", async () => {
    expect((await get(crypto.randomUUID())).status).toBe(404);
    expect((await get("../../etc/passwd")).status).toBe(404);
  });

  it("is a 404 with no Blob store, and when the bytes are gone", async () => {
    const { id, pathname } = await itemWithCleaned();
    blob.configured = false;
    expect((await get(id)).status).toBe(404);

    blob.configured = true;
    blob.files.delete(pathname);
    expect((await get(id)).status).toBe(404);
  });
});
