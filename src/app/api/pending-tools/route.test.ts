// @vitest-environment node
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../test/utils/session";

/** Withhold `tools.approve` for one test: only the creator's own rows come back. */
const override = vi.hoisted(() => ({ without: null as string | null }));
vi.mock("@/lib/auth/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth/permissions")>();
  return {
    ...actual,
    can: (subject: Parameters<typeof actual.can>[0], permission: string) =>
      permission === override.without ? false : actual.can(subject, permission as Parameters<typeof actual.can>[1]),
  };
});

import { createPendingBatch } from "@/lib/data/pending-tools";
import { resetDbForTests } from "@/lib/db/client";
import { GET, type PendingToolsListResponse } from "./route";

/**
 * `GET /api/pending-tools?ids=…` (data platform spec amendment "A photo for a
 * name"): the intake card reading its rows again while their photos are
 * looked up — one request for all of them, only the rows the caller may work.
 */

const AUTH_SECRET = "pending-tools-list-route-test-secret";

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
  counter += 1;
  owner = await signInAsNew({ email: `pl-owner-${counter}@cornell.edu`, role: "admin" });
  other = await signInAsNew({ email: `pl-other-${counter}@cornell.edu`, role: "admin" });
  student = await signInAsNew({ email: `pl-student-${counter}@cornell.edu`, role: "user" });
});

afterEach(() => resetAuthForTests());
afterAll(() => resetDbForTests());

function list(ids: string[], cookie: string | null) {
  ip += 1;
  const headers: Record<string, string> = { "x-forwarded-for": `10.8.0.${ip}` };
  if (cookie) headers.cookie = cookie;
  const request = new Request(`http://localhost/api/pending-tools?ids=${ids.join(",")}`, { headers });
  return GET(Object.assign(request, { nextUrl: new URL(request.url) }) as never);
}

async function mine(createdBy: string, name: string): Promise<string> {
  const { items } = await createPendingBatch({ createdBy, items: [{ name: `${name} ${counter}` }] });
  return items[0].id;
}

describe("GET /api/pending-tools", () => {
  it("answers the named rows the caller may work, in the browser's shape, uncached", async () => {
    const a = await mine(owner.user.id, "Listed Lathe");
    const b = await mine(owner.user.id, "Listed Bandsaw");
    const res = await list([a, b, "not-a-uuid", crypto.randomUUID()], owner.cookie);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as PendingToolsListResponse;
    expect(body.items.map((item) => item.id)).toEqual([a, b]);
    expect(body.items[0]).toMatchObject({ status: "identified", foundPhoto: null });
    expect(body.items[0]).not.toHaveProperty("createdBy");
  });

  it("leaves out somebody else's rows without tools.approve", async () => {
    const theirs = await mine(other.user.id, "Their Lathe");
    const own = await mine(owner.user.id, "Own Lathe");
    override.without = "tools.approve";
    const body = (await (await list([theirs, own], owner.cookie)).json()) as PendingToolsListResponse;
    expect(body.items.map((item) => item.id)).toEqual([own]);
  });

  it("answers 401 signed out, 403 to a student, and 400 for no ids or too many", async () => {
    const id = await mine(owner.user.id, "Gated Lathe");
    expect((await list([id], null)).status).toBe(401);
    expect((await list([id], student.cookie)).status).toBe(403);
    expect((await list([], owner.cookie)).status).toBe(400);
    expect((await list(Array.from({ length: 26 }, () => crypto.randomUUID()), owner.cookie)).status).toBe(400);
  });
});
