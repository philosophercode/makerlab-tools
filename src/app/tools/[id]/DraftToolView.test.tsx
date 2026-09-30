// @vitest-environment node
import { nextHeadersMock, setMockHeaders } from "../../../../test/mocks/next-headers";

vi.mock("next/headers", () => nextHeadersMock());

// `notFound()` throws in Next; here it throws something this test can name, so
// "the visitor gets the 404 page" is an assertion rather than an absence.
class NotFound extends Error {}
class Redirect extends Error {
  constructor(readonly to: string) {
    super(`redirect ${to}`);
  }
}
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new NotFound("not found");
  },
  redirect: (to: string) => {
    throw new Redirect(to);
  },
}));

import { resetAuthForTests } from "../../../lib/auth/config";
import { getDb, resetDbForTests } from "../../../lib/db/client";
import { session, tools, user } from "../../../lib/db/schema/index";
import type { Db } from "../../../lib/db/types";
import { signInAsNew } from "../../../../test/utils/session";
import { DraftToolView } from "./DraftToolView";

/**
 * Drafts at their own slug (spec §5.3(b)).
 *
 * **The refusal has to look the same as a slug nobody owns.** A distinct
 * message — a redirect, a "you may not see this" — would confirm that the draft
 * exists, which is precisely what `catalog.view_drafts` is withholding. So both
 * cases are asserted to be the same 404.
 */

const AUTH_SECRET = "draft-tool-view-test-secret";

let db: Db;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();

  db = await getDb();
  await db.delete(tools);
  await db.delete(session);
  await db.delete(user);

  await db.insert(tools).values({
    slug: "form-4",
    name: "Form 4",
    description: "A resin printer",
    published: false,
  });
});

afterEach(() => {
  resetAuthForTests();
  resetDbForTests();
});

/** What the page renders, or the refusal it threw. */
async function view(idOrSlug: string): Promise<"not-found" | "rendered" | `redirect:${string}`> {
  try {
    await DraftToolView({ idOrSlug });
    return "rendered";
  } catch (err) {
    if (err instanceof NotFound) return "not-found";
    if (err instanceof Redirect) return `redirect:${err.to}`;
    throw err;
  }
}

it("404s for an anonymous visitor", async () => {
  setMockHeaders();
  expect(await view("form-4")).toBe("not-found");
});

it("404s for a signed-in student", async () => {
  const student = await signInAsNew({ email: "student@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });

  expect(await view("form-4")).toBe("not-found");
});

it("renders the draft for somebody holding catalog.view_drafts", async () => {
  const maker = await signInAsNew({ email: "maker@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: maker.cookie });

  expect(await view("form-4")).toBe("rendered");
});

it("gives the same 404 for a slug nobody owns, whoever is asking", async () => {
  const maker = await signInAsNew({ email: "maker2@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: maker.cookie });
  expect(await view("no-such-tool")).toBe("not-found");

  setMockHeaders();
  expect(await view("no-such-tool")).toBe("not-found");
});

it("sends staff to the archived tool's row in Inventory instead of a 404", async () => {
  await db.insert(tools).values({
    slug: "old-laser",
    name: "Old laser",
    published: true,
    archivedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const maker = await signInAsNew({ email: "maker3@cornell.edu", role: "admin" });
  setMockHeaders({ cookie: maker.cookie });

  // Archived is still gone from the tool page; Inventory is where it can be restored.
  expect(await view("old-laser")).toBe("redirect:/admin/inventory?q=Old+laser&state=archived");
});

it("still 404s an archived tool for students and visitors", async () => {
  await db.insert(tools).values({
    slug: "old-laser-2",
    name: "Old laser 2",
    published: true,
    archivedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
  const student = await signInAsNew({ email: "student2@cornell.edu", role: "user" });
  setMockHeaders({ cookie: student.cookie });
  expect(await view("old-laser-2")).toBe("not-found");

  setMockHeaders();
  expect(await view("old-laser-2")).toBe("not-found");
});
