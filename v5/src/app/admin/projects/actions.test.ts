// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** Withhold or grant one permission — see `admin/corrections/actions.test.ts`. */
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

/**
 * A database that answers the *second* statement with an error.
 *
 * The audit insert happens after the row has already changed, so this is not an
 * exotic failure: they are two statements, and either can fail on its own.
 */
const audit = vi.hoisted(() => ({ failing: false }));

vi.mock("../../../lib/data/audit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../lib/data/audit")>();
  return {
    ...actual,
    recordAuditEvent: async (event: Parameters<typeof actual.recordAuditEvent>[0]) => {
      if (audit.failing) throw new Error("connection terminated unexpectedly");
      return actual.recordAuditEvent(event);
    },
  };
});

import { eq } from "drizzle-orm";
import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, projects, session, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { PROJECTS_TAG } from "../../../lib/revalidate";
import { signInAsNew } from "../../../../test/utils/session";
import { setPublished } from "./actions";

/**
 * The moderation gate's endpoint (spec §5.6, §4.10, §4.11, Article 5).
 *
 * Called directly, with no page: a server action is a POST endpoint with a
 * generated name, and this one decides what the public gallery shows — so the
 * gate in front of it is the whole of Article 5's "publishing takes a person
 * with the permission, in the app".
 */

const AUTH_SECRET = "admin-projects-test-secret";

let db: Db;
let projectId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  override.permissions = null;
  audit.failing = false;

  db = await getDb();
  await db.delete(auditEvents);
  await db.delete(projects);
  await db.delete(session);
  await db.delete(user);

  const [row] = await db
    .insert(projects)
    .values({
      slug: "resin-dice-tower",
      title: "Resin dice tower",
      body: "A dice tower.",
      published: false,
    })
    .returning({ id: projects.id });
  projectId = row.id;
});

afterEach(() => {
  override.permissions = null;
  audit.failing = false;
  resetAuthForTests();
  resetDbForTests();
});

async function storedProject() {
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  return row;
}

async function asSuperMaker(email = "niti@cornell.edu") {
  const signedIn = await signInAsNew({ email, role: "admin" });
  setMockHeaders({ cookie: signedIn.cookie });
  return signedIn;
}

it("refuses an anonymous caller, and the submission stays out of the gallery", async () => {
  setMockHeaders();

  expect(await setPublished({ projectId, published: true })).toEqual({
    ok: false,
    error: "not_signed_in",
  });
  expect((await storedProject()).published).toBe(false);
});

it("refuses a student, including the one who submitted it", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await setPublished({ projectId, published: true })).toEqual({
    ok: false,
    error: "not_permitted",
  });
  expect((await storedProject()).published).toBe(false);
});

it("checks projects.moderate, not tools.publish", async () => {
  await asSuperMaker();

  // Publishing a machine and publishing somebody's write-up are different
  // jobs, and `permissions.ts` declares them separately so they can diverge.
  override.permissions = new Set(["tools.publish", "tools.edit"]);
  expect(await setPublished({ projectId, published: true })).toEqual({
    ok: false,
    error: "not_permitted",
  });

  override.permissions = new Set(["projects.moderate"]);
  expect(await setPublished({ projectId, published: true })).toEqual({ ok: true });
});

it("publishes, stamps the row, records the event and busts the gallery cache", async () => {
  const signedIn = await asSuperMaker();
  const { revalidatePath, revalidateTag } = await import("next/cache");

  expect(await setPublished({ projectId, published: true })).toEqual({ ok: true });

  const row = await storedProject();
  expect(row.published).toBe(true);
  expect(row.publishedBy).toBe(signedIn.user.id);
  expect(row.publishedAt).toBeInstanceOf(Date);

  const [event] = await db.select().from(auditEvents);
  expect(event).toMatchObject({
    action: "project.published",
    subjectType: "project",
    subjectId: projectId,
    actorUserId: signedIn.user.id,
  });

  // Unlike a submission, which deliberately invalidates nothing: this write is
  // the one that changes which rows the cached gallery should hold (§3.9).
  expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith(PROJECTS_TAG, "minutes");
  expect(vi.mocked(revalidatePath)).toHaveBeenCalledWith("/admin/projects");
});

it("unpublishes as its own audited event, clearing the stamps", async () => {
  await asSuperMaker();
  await setPublished({ projectId, published: true });

  expect(await setPublished({ projectId, published: false })).toEqual({ ok: true });

  const row = await storedProject();
  expect(row.published).toBe(false);
  expect(row.publishedAt).toBeNull();
  expect(row.publishedBy).toBeNull();

  const actions = (await db.select().from(auditEvents)).map((event) => event.action);
  expect(actions).toContain("project.published");
  expect(actions).toContain("project.unpublished");
});

it("answers not_found for an unknown id, and publishes nothing", async () => {
  await asSuperMaker();

  expect(await setPublished({ projectId: crypto.randomUUID(), published: true })).toEqual({
    ok: false,
    error: "not_found",
  });
  expect((await storedProject()).published).toBe(false);
});

it("keeps the publish and warns when the audit event cannot be written", async () => {
  await asSuperMaker();
  audit.failing = true;

  // **Never `{ ok: false }` for a write that landed.** The island answers a
  // refusal by restoring the previous value, which would leave the page saying
  // the project is unpublished over a database that has published it (§4.11).
  expect(await setPublished({ projectId, published: true })).toEqual({
    ok: true,
    warning: "audit_unavailable",
  });

  expect((await storedProject()).published).toBe(true);
  expect(await db.select().from(auditEvents)).toEqual([]);
});
