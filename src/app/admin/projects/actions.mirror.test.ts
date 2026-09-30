// @vitest-environment node
import { nextCacheMock } from "../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

// The trigger has its own tests; here it is only asked whether it was called.
const mirror = vi.hoisted(() => ({ requestMirrorPush: vi.fn() }));

vi.mock("../../../lib/mirror/trigger", () => ({ requestMirrorPush: mirror.requestMirrorPush }));

import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { auditEvents, projects, session, user } from "../../../lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import { setPublished } from "./actions";

/**
 * Publishing and unpublishing a project are mirror triggers (spec §3.8
 * trigger 1): the mirror carries published projects only, so both directions
 * change what it should hold. A refused press changes nothing and asks for
 * nothing.
 */

const AUTH_SECRET = "admin-projects-mirror-test-secret";

let projectId: string;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  mirror.requestMirrorPush.mockReset().mockResolvedValue(undefined);

  const db = await getDb();
  await db.delete(auditEvents);
  await db.delete(projects);
  await db.delete(session);
  await db.delete(user);
  const [row] = await db
    .insert(projects)
    .values({ slug: "resin-dice-tower", title: "Resin dice tower", body: "A dice tower.", published: false })
    .returning({ id: projects.id });
  projectId = row.id;
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

it("requests a push after publishing, and again after unpublishing", async () => {
  const admin = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  expect(await setPublished({ projectId, published: true })).toEqual({ ok: true });
  expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(1);

  expect(await setPublished({ projectId, published: false })).toEqual({ ok: true });
  expect(mirror.requestMirrorPush).toHaveBeenCalledTimes(2);
});

it("requests nothing when the caller is refused", async () => {
  const student = await signInAsNew({ email: "casey@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await setPublished({ projectId, published: true })).toEqual({ ok: false, error: "not_permitted" });
  expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
});

it("requests nothing when the project does not exist", async () => {
  const admin = await signInAsNew({ email: "niti@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: admin.cookie });

  const result = await setPublished({ projectId: crypto.randomUUID(), published: true });

  expect(result.ok).toBe(false);
  expect(mirror.requestMirrorPush).not.toHaveBeenCalled();
});
