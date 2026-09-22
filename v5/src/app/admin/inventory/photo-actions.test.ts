// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { asc, eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { attachments, session, tools, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { attachPhotos, removePhoto, reorderPhotos } from "./photo-actions";

/**
 * The Photos section's endpoints (spec §5.3(3), §4.7).
 *
 * **Position 0 is the cover**, so ordering is the feature these three exist to
 * get right. Blob is never called here — the upload already happened at
 * `POST /api/uploads` and left an unowned row; these actions only ever move
 * rows around, which is why they work with no `BLOB_READ_WRITE_TOKEN`.
 */

const AUTH_SECRET = "photo-actions-test-secret";

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();

  db = await getDb();
  await db.delete(attachments);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  const [row] = await db
    .insert(tools)
    .values({ slug: "form-4", name: "Form 4" })
    .returning({ id: tools.id });
  toolId = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function asSuperMaker(email = "maker@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

async function revision(): Promise<string> {
  return (await readToolRevision(toolId))!;
}

/** An unowned upload row, exactly as `POST /api/uploads` leaves one. */
async function seedUpload(name: string): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/tool/${name}.jpg`,
      access: "public",
      publicUrl: `https://blob.test/${name}.jpg`,
      contentType: "image/jpeg",
      originalFilename: `${name}.jpg`,
    })
    .returning({ id: attachments.id });
  return row.id;
}

/** This tool's photos, cover first. */
async function order(): Promise<string[]> {
  const rows = await db
    .select({ id: attachments.id, filename: attachments.originalFilename })
    .from(attachments)
    .where(eq(attachments.ownerId, toolId))
    .orderBy(asc(attachments.position));
  return rows.map((row) => row.filename ?? row.id);
}

it("refuses an anonymous caller on all three, and claims nothing", async () => {
  setMockHeaders();
  const upload = await seedUpload("front");
  const input = { toolId, expectedRevision: await revision() };

  expect(await attachPhotos({ ...input, attachmentIds: [upload] })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(await reorderPhotos({ ...input, orderedIds: [upload] })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(await removePhoto({ ...input, attachmentId: upload })).toEqual({
    ok: false,
    error: "not_signed_in",
  });

  expect(await order()).toEqual([]);
});

it("appends new photos rather than making the newest one the cover", async () => {
  await asSuperMaker();
  const first = await attachPhotos({
    toolId,
    expectedRevision: await revision(),
    attachmentIds: [await seedUpload("front")],
  });
  expect(first.ok).toBe(true);

  await attachPhotos({
    toolId,
    expectedRevision: await revision(),
    attachmentIds: [await seedUpload("back")],
  });

  // `claimAttachments` numbers from zero, which on a tool that already has
  // photos would quietly replace the cover with the newest upload.
  expect(await order()).toEqual(["front.jpg", "back.jpg"]);
});

it("says how many stuck, and warns when some did not", async () => {
  await asSuperMaker();

  const result = await attachPhotos({
    toolId,
    expectedRevision: await revision(),
    // One real upload and one the daily cron already swept — what a panel left
    // open overnight sends.
    attachmentIds: [await seedUpload("front"), crypto.randomUUID()],
  });

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect([result.photosSubmitted, result.photosAttached]).toEqual([2, 1]);
  expect(result.warning).toBe("photos_not_attached");
});

it("reorders, which is also how the cover is chosen", async () => {
  await asSuperMaker();
  const front = await seedUpload("front");
  const back = await seedUpload("back");
  await attachPhotos({
    toolId,
    expectedRevision: await revision(),
    attachmentIds: [front, back],
  });

  const result = await reorderPhotos({
    toolId,
    expectedRevision: await revision(),
    orderedIds: [back, front],
  });

  expect(result.ok).toBe(true);
  expect(await order()).toEqual(["back.jpg", "front.jpg"]);
});

it("removes a photo and promotes the next one to cover", async () => {
  await asSuperMaker();
  const front = await seedUpload("front");
  const back = await seedUpload("back");
  await attachPhotos({
    toolId,
    expectedRevision: await revision(),
    attachmentIds: [front, back],
  });

  expect(
    (await removePhoto({ toolId, expectedRevision: await revision(), attachmentId: front })).ok
  ).toBe(true);

  expect(await order()).toEqual(["back.jpg"]);
  // Released, not deleted: the bytes go to the daily sweep, and the row is the
  // only thing that had to change for the photo to leave the page.
  const [row] = await db.select().from(attachments).where(eq(attachments.id, front));
  expect(row.ownerId).toBeNull();
});

it("will not remove a photo that belongs to another tool", async () => {
  await asSuperMaker();
  const [other] = await db
    .insert(tools)
    .values({ slug: "trotec", name: "Trotec Speedy 400" })
    .returning({ id: tools.id });
  const theirs = await seedUpload("theirs");
  await db
    .update(attachments)
    .set({ ownerType: "tool", ownerId: other.id, position: 0 })
    .where(eq(attachments.id, theirs));

  expect(
    await removePhoto({ toolId, expectedRevision: await revision(), attachmentId: theirs })
  ).toEqual({ ok: false, error: "not_found" });

  const [row] = await db.select().from(attachments).where(eq(attachments.id, theirs));
  expect(row.ownerId).toBe(other.id);
});
