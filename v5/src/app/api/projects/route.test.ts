// @vitest-environment node
import { eq } from "drizzle-orm";

import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew } from "../../../../test/utils/session";
import { nextCacheMock } from "../../../../test/mocks/next-cache";

// The route's neighbours in `src/lib/data` pull in modules that import
// cacheTag/cacheLife.
vi.mock("next/cache", () => nextCacheMock());

import { getCatalogTools } from "@/lib/catalog";
import { getPublishedProjects } from "@/lib/projects";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { attachments, projectTools, projects } from "@/lib/db/schema/index";

/**
 * `POST /api/projects` against the demo-seeded PGlite database, with **no
 * environment variables stubbed** — the submission is a Postgres row now, so
 * there is no credential this route could be missing (Article 3).
 */

const AUTH_SECRET = "projects-route-test-secret";

// The form submits catalogue ids — Postgres uuids minted at seed time — so
// they are resolved rather than hard-coded.
let FORM_4_ID = "";
let TROTEC_ID = "";

// The signed-in student every test submits as unless it says otherwise.
let defaultSession: Awaited<ReturnType<typeof signInAsNew>>;
let sessionCounter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  const tools = await getCatalogTools();
  FORM_4_ID = tools.find((tool) => tool.slug === "form-4")?.id ?? "";
  TROTEC_ID = tools.find((tool) => tool.slug === "trotec-speedy-400")?.id ?? "";

  const db = await getDb();
  // The demo seed ships one published sample project; clearing the table keeps
  // each test's assertions about "the submission" unambiguous.
  await db.delete(attachments);
  await db.delete(projects);

  // Since Phase 4 this route requires sign-in (spec §5.5), so the *default*
  // caller is a signed-in student. A fresh account per test on purpose: the
  // limiter keys a signed-in caller by user id, so one test's ten requests
  // must not be another's, the way `uniqueIp()` already isolates anonymous ones.
  sessionCounter += 1;
  defaultSession = await signInAsNew({
    email: `ada-${sessionCounter}@cornell.edu`,
    name: "Ada Lovelace",
  });
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

// ── Helpers ─────────────────────────────────────────────────────────

// The in-memory limiter is a per-process singleton keyed by `projects:<ip>` —
// every test gets its own IP so one test's requests can't exhaust another's
// window.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.1.0.${ipCounter}`;
}

interface SubmitOptions {
  ip?: string;
  raw?: string;
  /** A different session, or `null` to submit as an anonymous visitor. */
  cookie?: string | null;
}

// The route only uses `getClientIp(req)` (headers), the session cookie, and
// `req.json()`, so a plain Request is enough; it's cast at the call site because
// the signature asks for a NextRequest.
function submitRequest(payload: unknown, options: SubmitOptions = {}) {
  const { ip, raw } = options;
  const cookie =
    "cookie" in options ? options.cookie : defaultSession.cookie;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip ?? uniqueIp(),
  };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/projects", {
    method: "POST",
    headers,
    body: raw ?? JSON.stringify(payload),
  });
}

/**
 * A seeded session — a `user` row, a `session` row and the cookie Better Auth
 * would have set. The only way to reach the route as a signed-in person
 * without a network call (Article 3).
 */
async function signedIn(email: string, name: string) {
  return signInAsNew({ email, name });
}

function validPayload(overrides: Record<string, unknown> = {}) {
  return {
    title: "Lamp from scrap plywood",
    body: "Cut on the laser, glued, sanded.",
    tools: [FORM_4_ID],
    materials: ["Plywood"],
    photos: [{ id: "file-upload-1", name: "cover.png" }],
    ...overrides,
  };
}

async function loadRoute() {
  return import("./route");
}

async function post(req: Request) {
  const { POST } = await loadRoute();
  return POST(req as never);
}

/** Every project row currently in the table. */
async function storedProjects() {
  const db = await getDb();
  return db.select().from(projects);
}

/** An uploaded-but-unattached file, as `POST /api/uploads` will leave one. */
async function upload(): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(attachments)
    .values({
      blobPathname: `uploads/${crypto.randomUUID()}.png`,
      access: "public",
      publicUrl: `https://blob.test/${crypto.randomUUID()}.png`,
      contentType: "image/png",
    })
    .returning({ id: attachments.id });
  return row.id;
}

// ── The moderation gate (Article 5) ─────────────────────────────────

describe("POST /api/projects (drafts by default)", () => {
  it("records one unpublished row and answers with its id and slug", async () => {
    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(201);
    const rows = await storedProjects();
    expect(rows).toHaveLength(1);
    expect(await res.json()).toEqual({ id: rows[0].id, slug: rows[0].slug });
    expect(rows[0].published).toBe(false);
    expect(rows[0].slug).toBe("lamp-from-scrap-plywood");
  });

  it("IGNORES published:true from the client — the submission stays a draft", async () => {
    const res = await post(
      submitRequest(
        validPayload({ published: true, Published: true, fields: { published: true } })
      )
    );

    expect(res.status).toBe(201);
    // The single most important assertion in this feature: nothing a client
    // sends may publish a project. Staff publish it in the app, or it stays
    // invisible.
    const [row] = await storedProjects();
    expect(row.published).toBe(false);
    expect(row.publishedAt).toBeNull();
    expect(row.publishedBy).toBeNull();
  });

  it("does not appear in the gallery, which is what 'draft' actually means", async () => {
    await post(submitRequest(validPayload()));

    expect(await getPublishedProjects()).toEqual([]);
  });

  it("writes the submitted fields through to the row", async () => {
    const res = await post(
      submitRequest(
        validPayload({
          link: "https://example.com/lamp",
          tools: [FORM_4_ID, TROTEC_ID],
        })
      )
    );

    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    expect(row.title).toBe("Lamp from scrap plywood");
    expect(row.authorName).toBe("Ada Lovelace");
    expect(row.body).toBe("Cut on the laser, glued, sanded.");
    expect(row.link).toBe("https://example.com/lamp");
    expect(row.materials).toEqual(["Plywood"]);

    const db = await getDb();
    const links = await db
      .select()
      .from(projectTools)
      .where(eq(projectTools.projectId, row.id));
    expect(links.map((link) => link.toolId).sort()).toEqual([FORM_4_ID, TROTEC_ID].sort());
  });

  it("claims the uploaded photos onto the project, cover first", async () => {
    const cover = await upload();
    const second = await upload();

    const res = await post(
      submitRequest(
        validPayload({
          photos: [
            { id: cover, name: "cover.png" },
            { id: second, name: "detail.png" },
          ],
        })
      )
    );

    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    const db = await getDb();
    const photos = await db
      .select()
      .from(attachments)
      .where(eq(attachments.ownerId, row.id))
      .orderBy(attachments.position);
    expect(photos.map((photo) => photo.id)).toEqual([cover, second]);
    expect(photos.every((photo) => photo.ownerType === "project")).toBe(true);
  });

  it("records the submission even when no photo id matches an upload", async () => {
    // The write-up is worth more than the photos (Article 4) — and until
    // `/api/uploads` lands, the ids the form holds are Notion file_upload ids
    // that no `attachments` row answers to.
    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(201);
    expect(await storedProjects()).toHaveLength(1);
  });

  it("gives a second submission with the same title its own slug", async () => {
    await post(submitRequest(validPayload()));
    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(201);
    expect((await res.json()).slug).toBe("lamp-from-scrap-plywood-2");
  });
});

// ── Signing in is the gate (spec §5.5) ──────────────────────────────

describe("POST /api/projects (sign-in required)", () => {
  it("answers 401 to an anonymous submission and writes nothing", async () => {
    const res = await post(submitRequest(validPayload(), { cookie: null }));

    expect(res.status).toBe(401);
    // 401, not 403: signing in is something the visitor can actually do, and
    // the browser tells them so.
    expect(await res.json()).toMatchObject({ code: "sign_in_required" });
    expect(await storedProjects()).toHaveLength(0);
  });

  it("answers 401 to a forged cookie rather than trusting it", async () => {
    const forged = defaultSession.cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));

    const res = await post(submitRequest(validPayload(), { cookie: forged }));

    expect(res.status).toBe(401);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("answers 401 to a banned account — a ban resolves to anonymous", async () => {
    const banned = await signInAsNew({
      email: "banned@cornell.edu",
      name: "Ben Banned",
      banned: true,
    });

    const res = await post(submitRequest(validPayload(), { cookie: banned.cookie }));

    expect(res.status).toBe(401);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("accepts a signed-in student — `projects.submit` is what signing in grants", async () => {
    const res = await post(submitRequest(validPayload()));
    expect(res.status).toBe(201);
  });

  it("accepts a SuperMaker and a director too", async () => {
    for (const role of ["admin", "super_admin"] as const) {
      const { cookie } = await signInAsNew({
        email: `${role}@cornell.edu`,
        name: "Staff Person",
        role,
      });
      const res = await post(submitRequest(validPayload(), { cookie }));
      expect(res.status).toBe(201);
    }
  });
});

// ── Verified authorship (spec §4, §5) ───────────────────────────────

describe("POST /api/projects (author identity)", () => {
  it("records the author id from the session", async () => {
    const author = await signedIn("author@cornell.edu", "Ada Lovelace");

    const res = await post(submitRequest(validPayload(), { cookie: author.cookie }));

    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    expect(row.authorUserId).toBe(author.user.id);
    expect(row.createdBy).toBe(author.user.id);
    // The byline comes from the session too — the form stopped offering the
    // field, and this is what makes that guarantee real rather than cosmetic.
    expect(row.authorName).toBe("Ada Lovelace");
  });

  it("IGNORES an author supplied in the body", async () => {
    const { cookie } = await signedIn("author@cornell.edu", "Ada Lovelace");

    const res = await post(
      submitRequest(validPayload({ author: "Somebody Else" }), { cookie })
    );

    expect(res.status).toBe(201);
    expect((await storedProjects())[0].authorName).toBe("Ada Lovelace");
  });

  it("IGNORES author_email supplied in the body", async () => {
    const res = await post(
      submitRequest(
        validPayload({
          author_email: "dean@cornell.edu",
          authorEmail: "dean@cornell.edu",
        })
      )
    );

    expect(res.status).toBe(201);
    // A client may not assert who it is, and `projects` has no email column to
    // put one in even if it could.
    expect(JSON.stringify(await storedProjects())).not.toContain("dean@cornell.edu");
  });

  it("still refuses published:true from a signed-in client", async () => {
    const res = await post(submitRequest(validPayload({ published: true })));

    expect(res.status).toBe(201);
    // Signing in verifies who submitted; it does not publish anything.
    expect((await storedProjects())[0].published).toBe(false);
  });
});

// ── Validation ──────────────────────────────────────────────────────

describe("POST /api/projects (validation)", () => {
  it("rejects malformed JSON with 400", async () => {
    const res = await post(submitRequest(null, { raw: "{not json" }));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/invalid json/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it.each([
    ["title", { title: "" }],
    ["body", { body: "" }],
  ])("rejects a submission missing %s with 400", async (_field, overrides) => {
    const res = await post(submitRequest(validPayload(overrides)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/required/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("rejects an oversized write-up with 400", async () => {
    const res = await post(
      submitRequest(validPayload({ body: "x".repeat(20_001) }))
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too long/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("accepts a write-up right at the size limit", async () => {
    const res = await post(
      submitRequest(validPayload({ body: "x".repeat(20_000) }))
    );

    expect(res.status).toBe(201);
    expect(await storedProjects()).toHaveLength(1);
  });

  it("rejects more than 8 photos with 400 rather than silently dropping them", async () => {
    const photos = Array.from({ length: 9 }, (_, i) => ({
      id: `file-upload-${i}`,
      name: `photo-${i}.png`,
    }));

    const res = await post(submitRequest(validPayload({ photos })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/8 photos/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("accepts exactly 8 photos", async () => {
    const ids = await Promise.all(Array.from({ length: 8 }, () => upload()));
    const photos = ids.map((id, i) => ({ id, name: `photo-${i}.png` }));

    const res = await post(submitRequest(validPayload({ photos })));

    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    const db = await getDb();
    const owned = await db
      .select()
      .from(attachments)
      .where(eq(attachments.ownerId, row.id));
    expect(owned).toHaveLength(8);
  });

  it("rejects more than 20 tools with 400", async () => {
    const tools = Array.from({ length: 21 }, (_, i) => `tool-${i}`);

    const res = await post(submitRequest(validPayload({ tools })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/20 tools/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it("accepts exactly 20 tools", async () => {
    const tools = Array.from({ length: 20 }, () => crypto.randomUUID());

    const res = await post(submitRequest(validPayload({ tools })));

    // The cap is what is under test: twenty is not one too many. None of these
    // ids names a real tool, so the submission is filed with no links rather
    // than refused.
    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    const db = await getDb();
    expect(
      await db.select().from(projectTools).where(eq(projectTools.projectId, row.id))
    ).toEqual([]);
  });

  it("ignores non-string entries in tools and materials", async () => {
    const res = await post(
      submitRequest(
        validPayload({ tools: [FORM_4_ID, 7, null], materials: [{}, "Plywood"] })
      )
    );

    expect(res.status).toBe(201);
    const [row] = await storedProjects();
    expect(row.materials).toEqual(["Plywood"]);
    const db = await getDb();
    const links = await db
      .select()
      .from(projectTools)
      .where(eq(projectTools.projectId, row.id));
    expect(links.map((link) => link.toolId)).toEqual([FORM_4_ID]);
  });
});

// ── Link scheme validation ──────────────────────────────────────────

describe("POST /api/projects (link validation)", () => {
  it.each([
    "javascript:alert(document.cookie)",
    "JavaScript:alert(1)",
    "data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==",
    "file:///etc/passwd",
    "not a url at all",
  ])("rejects %s with 400 and writes nothing", async (link) => {
    const res = await post(submitRequest(validPayload({ link })));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/http/i);
    expect(await storedProjects()).toHaveLength(0);
  });

  it.each(["https://example.com/lamp", "http://example.com/lamp"])(
    "accepts %s",
    async (link) => {
      const res = await post(submitRequest(validPayload({ link })));

      expect(res.status).toBe(201);
      expect((await storedProjects())[0].link).toBe(link);
    }
  );
});

// ── Rate limiting ───────────────────────────────────────────────────

describe("POST /api/projects (rate limiting)", () => {
  it("returns 429 with Retry-After once the limiter says no", async () => {
    vi.resetModules();
    vi.doMock("@/lib/rate-limit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
        "@/lib/rate-limit"
      );
      return {
        ...actual,
        rateLimitAsync: vi.fn(async () => ({ allowed: false, remaining: 0 })),
      };
    });
    const { POST } = await import("./route");

    const res = await POST(submitRequest(validPayload()) as never);

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    expect((await res.json()).error).toMatch(/too many requests/i);
    // Rate limiting happens before any database work (Article 4).
    expect(await storedProjects()).toHaveLength(0);

    vi.doUnmock("@/lib/rate-limit");
    vi.resetModules();
  });

  it("starts refusing the same person once their window is exhausted", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await post(submitRequest(validPayload()));
      statuses.push(res.status);
    }

    expect(statuses[0]).toBe(201);
    expect(statuses).toContain(429);
    // Once refused, it stays refused for the rest of the window.
    expect(statuses.at(-1)).toBe(429);
    expect(await storedProjects()).toHaveLength(10);
  });

  it("keys a signed-in caller by who they are, not where they are", async () => {
    // Every request below comes from a different address. A signed-in caller
    // is keyed on their user id, so moving networks does not buy a fresh
    // allowance — and, the other way round, sharing a campus NAT does not
    // spend somebody else's.
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await post(submitRequest(validPayload(), { ip: uniqueIp() }));
      statuses.push(res.status);
    }

    expect(statuses.at(-1)).toBe(429);
  });

  it("does not penalize a different person", async () => {
    for (let i = 0; i < 12; i += 1) {
      await post(submitRequest(validPayload()));
    }

    const other = await signInAsNew({ email: "quiet@cornell.edu", name: "Quiet Person" });
    const res = await post(submitRequest(validPayload(), { cookie: other.cookie }));
    expect(res.status).toBe(201);
  });

  it("bounds an anonymous caller by IP, before telling them to sign in", async () => {
    const ip = uniqueIp();

    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      const res = await post(submitRequest(validPayload(), { ip, cookie: null }));
      statuses.push(res.status);
    }

    // The ordering is the point (Article 4): the limiter runs before the
    // sign-in check, so an unauthenticated flood is shed rather than answered.
    expect(statuses[0]).toBe(401);
    expect(statuses.at(-1)).toBe(429);
  });
});

// ── Database failure ────────────────────────────────────────────────

describe("POST /api/projects (database failure)", () => {
  it("returns 502 and does not leak the driver's error when the write fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.resetModules();
    vi.doMock("@/lib/data/projects", async () => {
      const actual =
        await vi.importActual<typeof import("@/lib/data/projects")>("@/lib/data/projects");
      return {
        ...actual,
        createProjectSubmission: vi.fn(async () => {
          throw new Error("connect ECONNREFUSED postgres://user:hunter2@127.0.0.1:1/none");
        }),
      };
    });
    const { POST } = await import("./route");

    const res = await POST(submitRequest(validPayload()) as never);

    expect(res.status).toBe(502);
    const raw = await res.text();
    expect(raw).not.toMatch(/hunter2|postgres|ECONNREFUSED/i);
    expect(JSON.parse(raw).error).toMatch(/try again/i);
    // The detail is still logged server-side.
    expect(error).toHaveBeenCalled();

    vi.doUnmock("@/lib/data/projects");
    vi.resetModules();
  });

  it("degrades to 401 when the session store itself is unreachable", async () => {
    // Documented consequence of Phase 4's ordering, not an accident:
    // `resolveIdentity` treats an unreachable database as "nobody is signed
    // in" so that public pages keep serving (Article 4), and this route checks
    // sign-in before it writes. A signed-in student therefore sees "sign in to
    // share a project" during an outage rather than "submission failed" — a
    // worse sentence than it could be, but it still leaks nothing and still
    // writes nothing.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("DATABASE_URL", "postgres://user:hunter2@127.0.0.1:1/none");
    resetDbForTests();
    resetAuthForTests();

    const res = await post(submitRequest(validPayload()));

    expect(res.status).toBe(401);
    expect(await res.text()).not.toMatch(/hunter2|ECONNREFUSED/i);

    warn.mockRestore();
    vi.stubEnv("DATABASE_URL", "");
    resetDbForTests();
    resetAuthForTests();
  });
});
