// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold one permission to prove the action asks for its own. Null means the real `can()`. */
const override = vi.hoisted(() => ({ permissions: null as Set<string> | null }));
vi.mock("../../../lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      override.permissions
        ? override.permissions.has(permission)
        : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

/** The archive workflow is started, never run, here. */
const archive = vi.hoisted(() => ({ requested: [] as string[][] }));
vi.mock("../../../lib/manuals/trigger", () => ({
  requestManualArchive: async (ids: readonly string[]) => {
    archive.requested.push([...ids]);
    return true;
  },
}));

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { attachments, manualDocuments, resources, session, tools, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { seedManual, seedTool } from "../../../../test/manuals/seed";
import { signInAsNew } from "../../../../test/utils/session";
import { reprocessLibraryManual } from "./actions";

/**
 * The Manuals page's Re-process (public polish): who may call it, that a
 * refusal is a value, and that a landed call marks the manual for the next
 * run and starts it.
 */

let db: Db;
let resourceId: string;
let documentId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", "admin-research-test-secret");
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  archive.requested = [];
  db = await getDb();
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);
  const toolId = await seedTool(db, { name: "Form 4" });
  const seeded = await seedManual(db, { toolId, title: "Form 4 manual", pages: ["Safety first."] });
  resourceId = seeded.resourceId;
  documentId = seeded.documentId;
});

afterEach(() => {
  override.permissions = null;
  resetAuthForTests();
  resetDbForTests();
});

async function extractorVersion() {
  const [doc] = await db.select().from(manualDocuments).where(eq(manualDocuments.id, documentId));
  return doc.extractorVersion;
}

it("refuses an anonymous caller and a student, and changes nothing", async () => {
  setMockHeaders();
  expect(await reprocessLibraryManual({ resourceId })).toEqual({ ok: false, error: "not_signed_in" });
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  expect(await reprocessLibraryManual({ resourceId })).toEqual({ ok: false, error: "not_permitted" });
  expect(await extractorVersion()).not.toBe("reprocess");
  expect(archive.requested).toEqual([]);
});

it("asks for tools.edit, not an adjacent permission", async () => {
  const staff = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: staff.cookie });
  override.permissions = new Set(["feedback.manage", "maintenance.manage"]);
  expect(await reprocessLibraryManual({ resourceId })).toEqual({ ok: false, error: "not_permitted" });
  override.permissions = new Set(["tools.edit"]);
  expect(await reprocessLibraryManual({ resourceId })).toEqual({ ok: true });
});

it("marks the manual for the next run, starts it and refreshes the page", async () => {
  const staff = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: staff.cookie });
  const { revalidatePath } = await import("next/cache");
  expect(await reprocessLibraryManual({ resourceId })).toEqual({ ok: true });
  expect(await extractorVersion()).toBe("reprocess");
  expect(archive.requested).toEqual([[resourceId]]);
  expect(revalidatePath).toHaveBeenCalledWith("/admin/research");
});

it("answers not_found for an id that is not a resource", async () => {
  const staff = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: staff.cookie });
  expect(await reprocessLibraryManual({ resourceId: "not-a-uuid" })).toEqual({ ok: false, error: "not_found" });
  expect(await reprocessLibraryManual({ resourceId: "00000000-0000-4000-8000-000000000000" })).toEqual({
    ok: false,
    error: "not_found",
  });
});
