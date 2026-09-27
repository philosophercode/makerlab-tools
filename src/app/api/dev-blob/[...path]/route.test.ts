// @vitest-environment node
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createLocalBlobBackend } from "../../../../lib/blob-local";
import { GET } from "./route";

/** `GET /api/dev-blob/…` against a temporary `.blob-data/`. */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "dev-blob-route-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function get(pathname: string) {
  return GET(new Request(`http://localhost:3001/api/dev-blob/${pathname}`), {
    params: Promise.resolve({ path: pathname.split("/") }),
  });
}

describe("GET /api/dev-blob/[...path]", () => {
  it("serves a public file with its stored content type", async () => {
    await createLocalBlobBackend().put("uploads/tool/plate.png", new Uint8Array([9, 8, 7]), {
      access: "public",
      contentType: "image/png",
    });

    const res = await get("uploads/tool/plate.png");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect([...new Uint8Array(await res.arrayBuffer())]).toEqual([9, 8, 7]);
  });

  it("404s a private file", async () => {
    await createLocalBlobBackend().put("backups/2026-07-29.json", "{}", {
      access: "private",
      contentType: "application/json",
    });
    expect((await get("backups/2026-07-29.json")).status).toBe(404);
  });

  it("404s a missing file", async () => {
    expect((await get("uploads/nope.png")).status).toBe(404);
  });

  it("404s traversal and the metadata folder", async () => {
    await createLocalBlobBackend().put("uploads/a.png", "x", { access: "public", contentType: "image/png" });
    expect((await get("../package.json")).status).toBe(404);
    expect((await get("uploads/../../etc/passwd")).status).toBe(404);
    expect((await get(".meta/uploads/a.png.json")).status).toBe(404);
  });

  it("404s everything outside local mode, even a public file", async () => {
    await createLocalBlobBackend().put("uploads/a.png", "x", { access: "public", contentType: "image/png" });
    expect((await get("uploads/a.png")).status).toBe(200);

    vi.stubEnv("VERCEL", "1");
    expect((await get("uploads/a.png")).status).toBe(404);
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("NODE_ENV", "production");
    expect((await get("uploads/a.png")).status).toBe(404);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    expect((await get("uploads/a.png")).status).toBe(404);
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_LOCAL_DISABLE", "1");
    expect((await get("uploads/a.png")).status).toBe(404);
  });
});
