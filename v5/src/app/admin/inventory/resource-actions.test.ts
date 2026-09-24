// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { readToolRevision } from "../../../lib/data/tools";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { attachments, resources, session, tools, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { addResource, editResource, removeResource } from "./resource-actions";

/**
 * The Resources section's endpoints (spec §5.3(3), §4.6).
 *
 * The upload itself is `POST /api/uploads`, which has its own tests; what these
 * actions do with the id it hands back is the part that belongs here. Nothing
 * in this file touches Blob, which is why it all runs with
 * `BLOB_READ_WRITE_TOKEN` unset.
 */

const AUTH_SECRET = "resource-actions-test-secret";

let db: Db;
let toolId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();

  db = await getDb();
  await db.delete(attachments);
  await db.delete(resources);
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
async function seedUpload(): Promise<string> {
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: "uploads/resource/manual.pdf",
      access: "public",
      publicUrl: "https://blob.test/manual.pdf",
      contentType: "application/pdf",
    })
    .returning({ id: attachments.id });
  return row.id;
}

it("refuses an anonymous caller on all three, and writes nothing", async () => {
  setMockHeaders();
  const input = { toolId, expectedRevision: await revision() };

  expect(await addResource({ ...input, resource: { title: "Manual" } })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect(
    await editResource({ ...input, resourceId: crypto.randomUUID(), patch: { title: "x" } })
  ).toEqual({ ok: false, error: "not_signed_in" });
  expect(await removeResource({ ...input, resourceId: crypto.randomUUID() })).toEqual({
    ok: false,
    error: "not_signed_in",
  });

  expect(await db.select().from(resources)).toEqual([]);
});

it("adds a link, and refuses one that is not a link", async () => {
  await asSuperMaker();

  const added = await addResource({
    toolId,
    expectedRevision: await revision(),
    resource: { title: "Formlabs support", type: "guide", url: "https://support.formlabs.com" },
  });
  expect(added.ok).toBe(true);

  // A bare `example.com` renders as a relative link and sends the reader to a
  // page on this site that does not exist.
  expect(
    await addResource({
      toolId,
      expectedRevision: await revision(),
      resource: { title: "Typo", url: "support.formlabs.com" },
    })
  ).toEqual({ ok: false, error: "invalid_field" });

  expect(await db.select().from(resources)).toHaveLength(1);
});

it("claims an uploaded PDF onto the resource it was uploaded for", async () => {
  await asSuperMaker();
  const attachmentId = await seedUpload();

  const added = await addResource({
    toolId,
    expectedRevision: await revision(),
    resource: { title: "Form 4 manual", type: "manual" },
    fileAttachmentIds: [attachmentId],
  });

  expect(added.ok).toBe(true);
  if (!added.ok) return;
  expect(added.filesSubmitted).toBe(1);
  expect(added.filesAttached).toBe(1);

  const [file] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  expect(file.ownerType).toBe("resource");
  expect(file.ownerId).toBe(added.resourceId);
});

it("says so when the file did not stick, and keeps the resource anyway", async () => {
  await asSuperMaker();

  // The id of an upload the daily cron already swept — what a panel left open
  // overnight sends. Thanking somebody for a manual nobody has is the quiet lie
  // Article 4 forbids; losing the link because its PDF expired is worse still.
  const added = await addResource({
    toolId,
    expectedRevision: await revision(),
    resource: { title: "Form 4 manual" },
    fileAttachmentIds: [crypto.randomUUID()],
  });

  expect(added.ok).toBe(true);
  if (!added.ok) return;
  expect([added.filesSubmitted, added.filesAttached]).toEqual([1, 0]);
  expect(added.warning).toBe("files_not_attached");
  expect(await db.select().from(resources)).toHaveLength(1);
});

it("edits a resource, including unpublishing it", async () => {
  await asSuperMaker();
  const added = await addResource({
    toolId,
    expectedRevision: await revision(),
    resource: { title: "Old SOP" },
  });
  if (!added.ok) throw new Error("expected the resource to be added");

  expect(
    (
      await editResource({
        toolId,
        expectedRevision: await revision(),
        resourceId: added.resourceId,
        patch: { published: false, notes: "Superseded" },
      })
    ).ok
  ).toBe(true);

  const [row] = await db.select().from(resources);
  expect(row.published).toBe(false);
  expect(row.notes).toBe("Superseded");
});

it("removes a resource and releases its files to the sweep", async () => {
  await asSuperMaker();
  const attachmentId = await seedUpload();
  const added = await addResource({
    toolId,
    expectedRevision: await revision(),
    resource: { title: "Form 4 manual" },
    fileAttachmentIds: [attachmentId],
  });
  if (!added.ok) throw new Error("expected the resource to be added");

  expect(
    (
      await removeResource({
        toolId,
        expectedRevision: await revision(),
        resourceId: added.resourceId,
      })
    ).ok
  ).toBe(true);

  expect(await db.select().from(resources)).toEqual([]);
  // Released rather than deleted: a file still owned by a row that no longer
  // exists is invisible to every read *and* to the orphan sweep.
  const [file] = await db.select().from(attachments).where(eq(attachments.id, attachmentId));
  expect(file.ownerId).toBeNull();
});

it("will not touch a resource belonging to another tool", async () => {
  await asSuperMaker();
  const [other] = await db
    .insert(tools)
    .values({ slug: "trotec", name: "Trotec Speedy 400" })
    .returning({ id: tools.id });
  const [theirs] = await db
    .insert(resources)
    .values({ toolId: other.id, title: "Laser manual" })
    .returning({ id: resources.id });

  expect(
    await removeResource({
      toolId,
      expectedRevision: await revision(),
      resourceId: theirs.id,
    })
  ).toEqual({ ok: false, error: "not_found" });
  expect(await db.select().from(resources)).toHaveLength(1);
});
