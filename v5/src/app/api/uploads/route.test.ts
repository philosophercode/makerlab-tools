// @vitest-environment node

// Vercel Blob is the one service here MSW cannot stand in for (the SDK talks to
// a signed API and would need a real token), so it is mocked at the seam
// `blob.ts` exists to provide — the same pattern the backup route test uses.
// `vi.hoisted` because the `vi.mock` factory runs before module scope exists.
const blob = vi.hoisted(() => ({
  configured: { value: true },
  putUpload: vi.fn(),
  put: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("../../../lib/blob", () => ({
  isBlobConfigured: () => blob.configured.value,
  getBlobStore: () => ({
    put: blob.put,
    putUpload: blob.putUpload,
    list: blob.list,
    del: blob.del,
  }),
}));

import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { attachments } from "@/lib/db/schema/index";
import { signInAsNew } from "../../../../test/utils/session";
import { POST } from "./route";

/**
 * `POST /api/uploads` against the demo-seeded PGlite database with the Blob
 * seam stubbed. No environment variable is set beyond the token flag and a
 * test-only `AUTH_SECRET`, and no request leaves the process (Article 3).
 */

const AUTH_SECRET = "uploads-route-test-secret";

const STORED = {
  pathname: "uploads/project/lamp-Xa9k2.png",
  url: "https://store.public.blob.vercel-storage.com/uploads/project/lamp-Xa9k2.png",
};

// A public `kind` needs a permission now, so the default caller for those tests
// is a signed-in student. Fresh per test: the limiter keys a signed-in caller
// by user id, so one test's fifteen uploads must not be another's — the same
// isolation `uniqueIp()` gives the anonymous ones.
let student: Awaited<ReturnType<typeof signInAsNew>>;
let studentCounter = 0;

beforeEach(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
  resetAuthForTests();
  blob.configured.value = true;
  blob.putUpload.mockReset().mockResolvedValue(STORED);
  blob.del.mockReset().mockResolvedValue(undefined);

  const db = await getDb();
  await db.delete(attachments);

  studentCounter += 1;
  student = await signInAsNew({ email: `ada-${studentCounter}@cornell.edu` });
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

// The in-memory limiter is a per-process singleton keyed by IP, so each test
// gets its own IP rather than inheriting a spent window.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `192.0.2.${ipCounter}`;
}

function imageFile(bytes = 3, name = "lamp.png", type = "image/png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

interface UploadOptions {
  kind?: string;
  ip?: string;
  /** A different session, or `null` to upload as an anonymous visitor. */
  cookie?: string | null;
}

function uploadRequest(file: File | null, options: UploadOptions = {}) {
  const form = new FormData();
  if (file) form.append("file", file);
  if (options.kind) form.append("kind", options.kind);
  // Signed in as the default student unless the test says otherwise: a public
  // `kind` requires a permission, and most of these tests use one.
  const cookie = "cookie" in options ? options.cookie : student.cookie;
  const headers: Record<string, string> = {
    "x-forwarded-for": options.ip ?? uniqueIp(),
  };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/uploads", {
    method: "POST",
    headers,
    body: form,
  }) as never;
}

async function rows() {
  const db = await getDb();
  return db.select().from(attachments);
}

/** A signed-in SuperMaker — the role that holds `tools.add` and `tools.edit`. */
async function asSuperMaker() {
  studentCounter += 1;
  return signInAsNew({ email: `maker-${studentCounter}@cornell.edu`, role: "admin" });
}

describe("POST /api/uploads — degrading honestly", () => {
  it("refuses with a machine-readable code when BLOB_READ_WRITE_TOKEN is unset", async () => {
    blob.configured.value = false;

    const res = await POST(uploadRequest(imageFile()));

    expect(res.status).toBe(503);
    // The client translates the code; the prose is for a log, not a student.
    expect((await res.json()).code).toBe("blob_not_configured");
  });

  it("never invents an attachment or touches the store when it cannot save", async () => {
    blob.configured.value = false;

    const res = await POST(uploadRequest(imageFile()));
    const body = await res.json();

    // The failure mode this route exists to avoid: an id handed back for a file
    // that was never stored, which a later claim would silently drop.
    expect(body.attachmentId).toBeUndefined();
    expect(blob.putUpload).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });
});

describe("POST /api/uploads — validation", () => {
  it("rejects a request with no file", async () => {
    const res = await POST(uploadRequest(null));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Missing file");
  });

  it("rejects an empty file", async () => {
    const res = await POST(uploadRequest(imageFile(0)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Empty file");
  });

  it("rejects a non-image", async () => {
    const res = await POST(
      uploadRequest(imageFile(3, "notes.txt", "text/plain"))
    );
    expect(res.status).toBe(400);
    expect(blob.putUpload).not.toHaveBeenCalled();
  });

  it("rejects an image over 18 MB", async () => {
    const res = await POST(uploadRequest(imageFile(19 * 1024 * 1024)));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("18MB");
  });

  it("accepts a PDF only for a resource upload", async () => {
    const pdf = () => imageFile(3, "manual.pdf", "application/pdf");
    const maker = await asSuperMaker();

    const rejected = await POST(uploadRequest(pdf(), { kind: "project" }));
    expect(rejected.status).toBe(400);

    const accepted = await POST(
      uploadRequest(pdf(), { kind: "resource", cookie: maker.cookie })
    );
    expect(accepted.status).toBe(200);
  });

  it("rejects a resource PDF over 20 MB", async () => {
    const maker = await asSuperMaker();
    const res = await POST(
      uploadRequest(
        imageFile(21 * 1024 * 1024, "manual.pdf", "application/pdf"),
        { kind: "resource", cookie: maker.cookie }
      )
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("20MB");
  });
});

describe("POST /api/uploads — the happy path", () => {
  it("stores the file and records an UNOWNED attachments row", async () => {
    const res = await POST(uploadRequest(imageFile(), { kind: "project" }));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.attachmentId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
    );

    const [row] = await rows();
    // Unowned on purpose: the project this photo belongs to does not exist yet.
    expect(row).toMatchObject({
      id: body.attachmentId,
      ownerType: null,
      ownerId: null,
      blobPathname: STORED.pathname,
      access: "public",
      contentType: "image/png",
      originalFilename: "lamp.png",
    });
  });

  it("records the pathname the store chose, not the one it was asked for", async () => {
    await POST(uploadRequest(imageFile(), { kind: "project" }));

    const [prefix] = blob.putUpload.mock.calls[0];
    expect(prefix).toBe("uploads/project/");
    const [row] = await rows();
    expect(row.blobPathname).toBe(STORED.pathname);
  });

  it("returns a preview URL for a public upload", async () => {
    const res = await POST(uploadRequest(imageFile(), { kind: "project" }));
    expect((await res.json()).previewUrl).toBe(STORED.url);
  });

  it("stores a maintenance photo PRIVATELY and returns no preview URL", async () => {
    const res = await POST(uploadRequest(imageFile(), { kind: "maintenance" }));

    // §3.3: maintenance photos may show people. A private blob has no URL an
    // unauthenticated viewer can follow, so the client keeps showing its own
    // object-URL preview instead.
    expect(blob.putUpload.mock.calls[0][2]).toBe("private");
    expect((await res.json()).previewUrl).toBeNull();
    expect((await rows())[0]).toMatchObject({ access: "private", publicUrl: null });
  });

  it("treats an unrecognised kind as a chat upload rather than failing", async () => {
    const res = await POST(uploadRequest(imageFile(), { kind: "nonsense" }));

    expect(res.status).toBe(200);
    expect(blob.putUpload.mock.calls[0][0]).toBe("uploads/chat/");
  });

  it("uploads anonymously — no sign-in is required to report a broken machine", async () => {
    await POST(uploadRequest(imageFile(), { kind: "maintenance", cookie: null }));
    expect((await rows())[0].uploadedBy).toBeNull();
  });

  it("records the uploader when there is one", async () => {
    await POST(uploadRequest(imageFile(), { kind: "project" }));
    expect((await rows())[0].uploadedBy).toBe(student.user.id);
  });
});

describe("POST /api/uploads — who may ask for a public URL", () => {
  /**
   * The regression this guards: `kind` came straight off the request body and
   * was the only thing deciding public vs private, so
   * `curl -F kind=resource -F file=@anything.pdf .../api/uploads` with no
   * cookie got back a permanent, world-readable Blob URL for a 20 MB PDF the
   * lab never agreed to host — claimed by nothing, and swept only if still
   * unclaimed 24 hours later. Every surface that *consumes* a public kind
   * already requires sign-in, so no legitimate flow ever needed this.
   */
  const publicKinds = ["project", "tool", "resource"] as const;

  it.each(publicKinds)("refuses an anonymous caller asking for kind=%s", async (kind) => {
    const res = await POST(uploadRequest(imageFile(), { kind, cookie: null }));

    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("sign_in_required");
    // Nothing was written: no blob, no row, no id handed back.
    expect(blob.putUpload).not.toHaveBeenCalled();
    expect(await rows()).toHaveLength(0);
  });

  it("refuses a signed-in student asking for a catalogue image", async () => {
    // 403, not 401: signing in is what they already did, and it did not help.
    const res = await POST(uploadRequest(imageFile(), { kind: "tool" }));

    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("forbidden");
    expect(blob.putUpload).not.toHaveBeenCalled();
  });

  it("lets a SuperMaker upload a catalogue image and a manual", async () => {
    const maker = await asSuperMaker();

    for (const kind of ["tool", "resource"] as const) {
      const res = await POST(
        uploadRequest(imageFile(), { kind, cookie: maker.cookie })
      );
      expect(res.status, kind).toBe(200);
    }
  });

  it("still lets an anonymous student send a chat or maintenance photo", async () => {
    for (const kind of ["chat", "maintenance"] as const) {
      const res = await POST(
        uploadRequest(imageFile(), { kind, cookie: null })
      );
      expect(res.status, kind).toBe(200);
      // Private, so there is no public URL to hand out in the first place —
      // which is what makes leaving these two open safe.
      expect((await res.json()).previewUrl).toBeNull();
    }
  });

  it("refuses on the permission, not on the size", async () => {
    const res = await POST(
      uploadRequest(imageFile(19 * 1024 * 1024), { kind: "resource", cookie: null })
    );
    // 401 rather than the 400 the oversize check would give: the caller is told
    // they may not ask at all, which is the more useful of the two answers.
    //
    // It is not free, though. `req.formData()` has already parsed the body by
    // the time the permission is checked, so an anonymous caller can still make
    // the server read 19 MB; only the 15/min-per-IP limiter bounds that. Nothing
    // is stored and no URL comes back, which is what the check is for — moving
    // it ahead of the parse would be a separate change.
    expect(res.status).toBe(401);
  });

  it("does not let an unrecognised kind smuggle in a public upload", async () => {
    // `nonsense` falls back to `chat`, which is private and open — so the
    // fallback cannot be used to reach a public URL without a permission.
    const res = await POST(
      uploadRequest(imageFile(), { kind: "nonsense", cookie: null })
    );

    expect(res.status).toBe(200);
    expect(blob.putUpload.mock.calls[0][2]).toBe("private");
    expect((await res.json()).previewUrl).toBeNull();
  });
});

describe("POST /api/uploads — failures leave nothing behind", () => {
  it("answers 502 when the blob write fails, and records nothing", async () => {
    blob.putUpload.mockRejectedValueOnce(new Error("network down"));

    const res = await POST(uploadRequest(imageFile()));

    expect(res.status).toBe(502);
    expect(await rows()).toHaveLength(0);
  });

  it("deletes the stored blob when the attachments insert fails", async () => {
    // Staged by pointing the row's `access` at a value the CHECK constraint
    // rejects, so the insert fails the way a real constraint violation would.
    blob.putUpload.mockResolvedValueOnce({
      pathname: "uploads/project/x.png",
      url: "x",
    });
    const db = await getDb();
    const insert = vi
      .spyOn(db, "insert")
      .mockImplementation(() => {
        throw new Error("insert failed");
      });

    try {
      const res = await POST(uploadRequest(imageFile(), { kind: "project" }));

      expect(res.status).toBe(502);
      // Otherwise the bytes sit in the store forever: the cron only sweeps
      // files that have a row to find them by.
      expect(blob.del).toHaveBeenCalledWith(["uploads/project/x.png"]);
    } finally {
      insert.mockRestore();
    }
  });
});

describe("POST /api/uploads — rate limiting", () => {
  it("answers 429 after 15 uploads in a minute from one caller", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 15; i += 1) {
      const ok = await POST(uploadRequest(imageFile(), { kind: "project", ip }));
      expect(ok.status).toBe(200);
    }

    const res = await POST(uploadRequest(imageFile(), { kind: "project", ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
  });

  it("refuses before reading the body, so a flood costs no bytes", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 15; i += 1) {
      await POST(uploadRequest(imageFile(), { kind: "project", ip }));
    }
    blob.putUpload.mockClear();

    await POST(uploadRequest(imageFile(), { kind: "project", ip }));
    expect(blob.putUpload).not.toHaveBeenCalled();
  });
});
