// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getBlobStore, isBlobConfigured } from "./blob";
import {
  createLocalBlobBackend,
  localBlobRoot,
  localBlobUrl,
  resolveLocalPath,
} from "./blob-local";
import { createBlobUploader } from "./import/blob-uploader";

/**
 * The `.blob-data/` store against a temporary folder. `process.cwd()` is
 * pointed at the folder so the default root is exercised too; nothing touches
 * the working tree.
 */

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "blob-local-"));
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("VERCEL", "");
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("BLOB_LOCAL_DISABLE", "");
  vi.stubEnv("BLOB_LOCAL_DIR", "");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3001/");
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function photo(name = "broken bed.png", type = "image/png") {
  return new File([new Uint8Array([1, 2, 3])], name, { type });
}

describe("local mode through the BlobStore seam", () => {
  it("counts as configured, and is not configured once disabled", () => {
    expect(isBlobConfigured()).toBe(true);
    vi.stubEnv("BLOB_LOCAL_DISABLE", "1");
    expect(isBlobConfigured()).toBe(false);
  });

  it("put writes a private file at exactly its pathname and overwrites on re-run", async () => {
    const store = getBlobStore();
    expect(await store.put("backups/2026-07-29.json", "{}", "application/json")).toEqual({
      pathname: "backups/2026-07-29.json",
    });
    await store.put("backups/2026-07-29.json", '{"a":1}', "application/json");

    expect(await readFile(join(dir, ".blob-data/backups/2026-07-29.json"), "utf8")).toBe('{"a":1}');
    const read = await createLocalBlobBackend().read("backups/2026-07-29.json");
    expect(read?.meta).toMatchObject({ access: "private", contentType: "application/json", size: 7 });
  });

  it("putUpload stores at a random pathname under the prefix, with a dev-blob URL", async () => {
    const stored = await getBlobStore().putUpload("uploads/project/", photo(), "public");

    expect(stored.pathname).toMatch(/^uploads\/project\/broken-bed-[A-Za-z0-9]{8,}\.png$/);
    expect(stored.url).toBe(`http://localhost:3001/api/dev-blob/${stored.pathname}`);
    const read = await createLocalBlobBackend().read(stored.pathname);
    expect(read?.meta).toMatchObject({ access: "public", contentType: "image/png", size: 3 });
    expect([...read!.body]).toEqual([1, 2, 3]);
  });

  it("two uploads of the same name never collide", async () => {
    const store = getBlobStore();
    const a = await store.putUpload("uploads/chat/", photo("IMG_0001.jpg", "image/jpeg"), "private");
    const b = await store.putUpload("uploads/chat/", photo("IMG_0001.jpg", "image/jpeg"), "private");
    expect(a.pathname).not.toBe(b.pathname);
  });

  it("strips path separators out of an untrusted filename", async () => {
    const stored = await getBlobStore().putUpload("uploads/project/", photo("../../etc/passwd.png"), "public");
    expect(stored.pathname).toMatch(/^uploads\/project\/etc-passwd-[A-Za-z0-9]+\.png$/);
  });

  it("copyToPublic makes a public copy at a new random pathname and leaves the source", async () => {
    const store = getBlobStore();
    const source = await store.putUpload("uploads/chat/", photo("plate.jpg", "image/jpeg"), "private");
    const copy = await store.copyToPublic(source.pathname, "uploads/tool/");

    expect(copy.pathname.startsWith("uploads/tool/plate-")).toBe(true);
    expect(copy.pathname).not.toBe(`uploads/tool/${source.pathname.split("/").pop()}`);
    const disk = createLocalBlobBackend();
    expect((await disk.read(copy.pathname))?.meta).toMatchObject({ access: "public", contentType: "image/jpeg" });
    expect((await disk.read(source.pathname))?.meta.access).toBe("private");
  });

  it("copyToPublic rejects for a missing source rather than reporting a URL", async () => {
    await expect(getBlobStore().copyToPublic("uploads/chat/nope.jpg", "uploads/tool/")).rejects.toThrow();
  });

  it("list returns every blob under a prefix, and del removes them", async () => {
    const store = getBlobStore();
    await store.put("backups/a.json", "{}", "application/json");
    await store.put("backups/b.json", "{}", "application/json");
    await store.putUpload("uploads/chat/", photo(), "private");

    const backups = await store.list("backups/");
    expect(backups.map((b) => b.pathname)).toEqual(["backups/a.json", "backups/b.json"]);
    expect(backups[0].uploadedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await store.list("uploads/")).toHaveLength(1);

    await store.del(["backups/a.json"]);
    expect((await store.list("backups/")).map((b) => b.pathname)).toEqual(["backups/b.json"]);
    await store.del([]);
  });

  it("list is empty before anything has been written", async () => {
    expect(await getBlobStore().list("backups/")).toEqual([]);
  });
});

describe("the backend's own rules", () => {
  it("refuses to overwrite unless allowed", async () => {
    const disk = createLocalBlobBackend();
    await disk.put("a/b.txt", "1", { access: "private" });
    await expect(disk.put("a/b.txt", "2", { access: "private" })).rejects.toThrow("already exists");
  });

  it("refuses traversal, absolute paths and the metadata folder", async () => {
    const disk = createLocalBlobBackend();
    for (const bad of ["../escape.txt", "a/../../escape.txt", "/etc/passwd", ".meta/x.json", "a//b", "a\\b", ""]) {
      await expect(disk.put(bad, "x", { access: "public" })).rejects.toThrow("Invalid blob pathname");
      expect(() => resolveLocalPath(dir, bad)).toThrow();
    }
    expect(await createLocalBlobBackend().list("")).toEqual([]);
  });

  it("encodes each segment of a URL", () => {
    expect(localBlobUrl("uploads/a b#c.png")).toBe("http://localhost:3001/api/dev-blob/uploads/a%20b%23c.png");
  });

  it("falls back to localhost:3000 without AUTH_BASE_URL", () => {
    vi.stubEnv("AUTH_BASE_URL", "");
    expect(localBlobUrl("x.pdf")).toBe("http://localhost:3000/api/dev-blob/x.pdf");
  });
});

describe("createBlobUploader (the step-code path)", () => {
  it("is the local store in local mode, with a random suffix", async () => {
    const uploader = createBlobUploader();
    expect(uploader).not.toBeNull();
    const stored = await uploader!.put("manuals/t1/r1.pdf", new TextEncoder().encode("%PDF-1.7"), {
      access: "public",
      contentType: "application/pdf",
    });
    expect(stored.pathname).toMatch(/^manuals\/t1\/r1-[A-Za-z0-9]+\.pdf$/);
    expect(stored.url).toBe(`http://localhost:3001/api/dev-blob/${stored.pathname}`);
    expect((await createLocalBlobBackend().read(stored.pathname))?.meta).toMatchObject({
      access: "public",
      contentType: "application/pdf",
      size: 8,
    });
  });

  it("is null with no store at all", () => {
    vi.stubEnv("BLOB_LOCAL_DISABLE", "1");
    expect(createBlobUploader()).toBeNull();
  });
});

describe("localBlobRoot", () => {
  it("is .blob-data/ in the working directory by default", () => {
    expect(localBlobRoot()).toBe(join(dir, ".blob-data"));
  });

  it("is BLOB_LOCAL_DIR when set (the E2E server's own folder), relative to the working directory", async () => {
    vi.stubEnv("BLOB_LOCAL_DIR", ".blob-data-e2e");
    expect(localBlobRoot()).toBe(join(dir, ".blob-data-e2e"));
    const stored = await createBlobUploader()!.put("research/cleaned/x.png", new Uint8Array([1]), {
      access: "private",
      contentType: "image/png",
    });
    expect(await readFile(join(dir, ".blob-data-e2e", stored.pathname))).toHaveLength(1);
  });
});
