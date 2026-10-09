// @vitest-environment node
import { eq } from "drizzle-orm";
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../../../test/utils/session";

/** Withhold `tools.approve` for one test: the creator still sees, nobody else does. */
const override = vi.hoisted(() => ({ without: null as string | null }));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      permission === override.without ? false : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
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

import { createPendingBatch } from "@/lib/data/pending-tools";
import { recordCleanedImage } from "@/lib/data/research-images";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { pendingTools } from "@/lib/db/schema/index";
import type { FoundPhoto } from "@/lib/intake/found-photo";
import { GET } from "./route";

/**
 * `GET /api/pending-tools/[id]/found-photo` (data platform spec amendment "A
 * photo for a name"): the private cleaned copy of a looked-up photo, to the
 * people who may work the item, uncached; a 404 for everything else.
 */

const AUTH_SECRET = "found-photo-route-test-secret";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);
const FROM = "https://www.maker.example/img/front.png";

let owner: Awaited<ReturnType<typeof signInAsNew>>;
let other: Awaited<ReturnType<typeof signInAsNew>>;
let student: Awaited<ReturnType<typeof signInAsNew>>;
let counter = 0;
let ip = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  override.without = null;
  blob.configured = true;
  blob.files.clear();
  blob.read.mockReset().mockImplementation(async (pathname: string, access = "private") => {
    const file = blob.files.get(pathname);
    return file && file.access === access ? { body: file.bytes, contentType: "image/png" } : null;
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  counter += 1;
  owner = await signInAsNew({ email: `fp-owner-${counter}@cornell.edu`, role: "admin" });
  other = await signInAsNew({ email: `fp-other-${counter}@cornell.edu`, role: "admin" });
  student = await signInAsNew({ email: `fp-student-${counter}@cornell.edu`, role: "user" });
});

afterEach(() => resetAuthForTests());
afterAll(() => resetDbForTests());

/** An item owned by `owner` whose lookup found a picture with a cleaned copy stored privately. */
async function itemWithFoundPhoto(): Promise<{ id: string; attachmentId: string }> {
  const { items } = await createPendingBatch({ createdBy: owner.user.id, items: [{ name: `Found Photo Lathe ${counter}` }] });
  const id = items[0].id;
  const db = await getDb();
  const pathname = `research/cleaned/${id}-x.png`;
  const attachmentId = await recordCleanedImage(db, { pendingId: id, blobPathname: pathname, sizeBytes: PNG.byteLength, width: 10, height: 10, fromUrl: FROM });
  blob.files.set(pathname, { access: "private", bytes: PNG });
  const found: FoundPhoto = {
    requestId: crypto.randomUUID(),
    requestedAt: new Date().toISOString(),
    status: "found",
    candidate: { url: FROM, pageUrl: null, source: "exa", width: 1200, height: 900, contentType: "image/png", rank: 1, reason: "front" },
    cleaned: { attachmentId, fromUrl: FROM },
    error: null,
  };
  await db.update(pendingTools).set({ foundPhoto: found }).where(eq(pendingTools.id, id));
  return { id, attachmentId };
}

function get(id: string, cookie: string | null) {
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.9.0.${ip}` };
  if (cookie) headers.cookie = cookie;
  return GET(new Request(`http://localhost/api/pending-tools/${id}/found-photo`, { headers }) as never, { params: Promise.resolve({ id }) });
}

describe("GET /api/pending-tools/[id]/found-photo", () => {
  it("serves the cleaned copy to the item's creator, uncached", async () => {
    const { id } = await itemWithFoundPhoto();
    const res = await get(id, owner.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PNG);
  });

  it("serves an approver who is not the creator, and refuses them without tools.approve", async () => {
    const { id } = await itemWithFoundPhoto();
    expect((await get(id, other.cookie)).status).toBe(200);
    override.without = "tools.approve";
    expect((await get(id, other.cookie)).status).toBe(403);
    expect((await get(id, owner.cookie)).status).toBe(200);
  });

  it("answers 401 signed out and 403 to a student", async () => {
    const { id } = await itemWithFoundPhoto();
    expect((await get(id, null)).status).toBe(401);
    expect((await get(id, student.cookie)).status).toBe(403);
  });

  it("answers 404 for no item, no cleaned copy, a released copy and no Blob store", async () => {
    expect((await get(crypto.randomUUID(), owner.cookie)).status).toBe(404);
    const { id, attachmentId } = await itemWithFoundPhoto();
    const db = await getDb();
    const { attachments } = await import("@/lib/db/schema/index");
    await db.update(attachments).set({ ownerType: null, ownerId: null }).where(eq(attachments.id, attachmentId));
    expect((await get(id, owner.cookie)).status).toBe(404);
    await db.update(pendingTools).set({ foundPhoto: null }).where(eq(pendingTools.id, id));
    expect((await get(id, owner.cookie)).status).toBe(404);
    const second = await itemWithFoundPhoto();
    blob.configured = false;
    expect((await get(second.id, owner.cookie)).status).toBe(404);
  });
});
