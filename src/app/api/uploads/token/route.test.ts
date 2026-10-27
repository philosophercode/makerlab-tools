// @vitest-environment node

// The Blob SDK talks to a signed API, so its two calls are mocked at the
// import: `handleUpload` runs the route's own `onBeforeGenerateToken` and
// answers with a fake token; `head` reports what a stored blob is.
const sdk = vi.hoisted(() => ({
  head: vi.fn(),
  handleUpload: vi.fn(),
}));
vi.mock("@vercel/blob", () => ({ head: sdk.head }));
vi.mock("@vercel/blob/client", () => ({ handleUpload: sdk.handleUpload }));

import { resetAuthForTests } from "@/lib/auth/config";
import { findAttachmentsByIds } from "@/lib/data/attachments";
import { resetDbForTests } from "@/lib/db/client";
import { signInAsNew, type SignedInSession } from "../../../../../test/utils/session";
import { POST } from "./route";

/**
 * `POST /api/uploads/token` (import progress spec 2026-10-27 §3.5): a list
 * over the function's body limit goes from the browser straight to Blob. The
 * token is issued only to staff, only for their own folder and only within
 * the import limits; completing records the same private attachment
 * `POST /api/uploads` writes, once.
 */

const AUTH_SECRET = "uploads-token-route-test-secret";
let counter = 0;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_PRIVATE_STORE_ID", "");
  resetAuthForTests();
  sdk.head.mockReset();
  sdk.handleUpload.mockReset().mockImplementation(async (options: { body: { payload: { pathname: string; clientPayload: string } }; onBeforeGenerateToken: (p: string, c: string, m: boolean) => Promise<unknown> }) => {
    const constraints = await options.onBeforeGenerateToken(options.body.payload.pathname, options.body.payload.clientPayload, true);
    return { type: "blob.generate-client-token", clientToken: "client-token", constraints };
  });
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function person(role: "user" | "admin"): Promise<SignedInSession> {
  counter += 1;
  return signInAsNew({ email: `upload-token-${counter}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
}

async function post(body: unknown, session: SignedInSession | null) {
  counter += 1;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.45.${counter % 250}.1` };
  if (session) headers.cookie = session.cookie;
  const res = await POST(new Request("http://localhost/api/uploads/token", { method: "POST", headers, body: JSON.stringify(body) }) as never);
  return { status: res.status, body: await res.json() };
}

function tokenRequest(pathname: string, file: { name: string; type: string; size: number }) {
  return { type: "blob.generate-client-token", payload: { pathname, clientPayload: JSON.stringify(file), multipart: true } };
}

describe("POST /api/uploads/token", () => {
  it("refuses an anonymous visitor and a student before anything else", async () => {
    expect((await post({ type: "import.folder" }, null)).status).toBe(401);
    expect(await post({ type: "import.folder" }, await person("user"))).toMatchObject({ status: 403, body: { code: "forbidden" } });
  });

  it("says a direct upload is unavailable where nothing can sign one", async () => {
    const admin = await person("admin");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(await post({ type: "import.folder" }, admin)).toMatchObject({ status: 501, body: { code: "client_upload_unavailable" } });
    // A private store linked by id alone cannot sign either, and the public token must not stand in.
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    vi.stubEnv("BLOB_PRIVATE_STORE_ID", "store_private");
    expect((await post({ type: "import.folder" }, admin)).status).toBe(501);
  });

  it("issues a token only for the caller's own folder, a list type and the import limits", async () => {
    const admin = await person("admin");
    const { body: folder } = await post({ type: "import.folder" }, admin);
    expect(folder.prefix).toBe(`uploads/import/${admin.user.id}/`);

    const ok = await post(tokenRequest(`${folder.prefix}tools.csv`, { name: "tools.csv", type: "text/csv", size: 4_800_000 }), admin);
    expect(ok.status).toBe(200);
    expect(ok.body.constraints).toMatchObject({ maximumSizeInBytes: 5 * 1024 * 1024, addRandomSuffix: true });

    const pdf = await post(tokenRequest(`${folder.prefix}inventory.pdf`, { name: "inventory.pdf", type: "application/pdf", size: 15_000_000 }), admin);
    expect(pdf.body.constraints).toMatchObject({ maximumSizeInBytes: 20 * 1024 * 1024, allowedContentTypes: ["application/pdf"] });

    const elsewhere = await post(tokenRequest("uploads/import/someone-else/tools.csv", { name: "tools.csv", type: "text/csv", size: 10 }), admin);
    expect(elsewhere).toMatchObject({ status: 403, body: { code: "forbidden" } });
    const tooBig = await post(tokenRequest(`${folder.prefix}tools.csv`, { name: "tools.csv", type: "text/csv", size: 6 * 1024 * 1024 }), admin);
    expect(tooBig).toMatchObject({ status: 400, body: { code: "file_too_large" } });
    const photo = await post(tokenRequest(`${folder.prefix}a.png`, { name: "a.png", type: "image/png", size: 10 }), admin);
    expect(photo).toMatchObject({ status: 400, body: { code: "unsupported_file" } });
  });

  it("records a completed upload once, private and unowned, and only the uploader's", async () => {
    const admin = await person("admin");
    const pathname = `uploads/import/${admin.user.id}/tools-Xa9k2.csv`;
    sdk.head.mockResolvedValue({ pathname, size: 4_800_000, contentType: "text/csv" });

    const first = await post({ type: "import.complete", pathname, name: "tools.csv" }, admin);
    expect(first.status).toBe(200);
    const [row] = await findAttachmentsByIds([first.body.attachmentId]);
    expect(row).toMatchObject({ blobPathname: pathname, access: "private" });

    const again = await post({ type: "import.complete", pathname, name: "tools.csv" }, admin);
    expect(again.body.attachmentId).toBe(first.body.attachmentId);

    const other = await person("admin");
    expect((await post({ type: "import.complete", pathname, name: "tools.csv" }, other)).status).toBe(403);
  });

  it("refuses a completion whose blob is missing or over the limit", async () => {
    const admin = await person("admin");
    sdk.head.mockRejectedValueOnce(new Error("not found"));
    const missing = await post({ type: "import.complete", pathname: `uploads/import/${admin.user.id}/gone.csv`, name: "gone.csv" }, admin);
    expect(missing).toMatchObject({ status: 404, body: { code: "file_not_found" } });

    sdk.head.mockResolvedValueOnce({ pathname: `uploads/import/${admin.user.id}/big.csv`, size: 9 * 1024 * 1024, contentType: "text/csv" });
    const big = await post({ type: "import.complete", pathname: `uploads/import/${admin.user.id}/big.csv`, name: "big.csv" }, admin);
    expect(big).toMatchObject({ status: 400, body: { code: "file_too_large" } });
  });
});
