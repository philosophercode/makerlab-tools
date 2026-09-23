// The Vercel Blob SDK talks to a signed API and would need a real token, so it
// is mocked at the module boundary. `vi.hoisted` because the `vi.mock` factory
// runs before module scope exists.
const sdk = vi.hoisted(() => ({
  put: vi.fn(),
  copy: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: sdk.put,
  copy: sdk.copy,
  list: sdk.list,
  del: sdk.del,
}));

import { getBlobStore, isBlobConfigured } from "./blob";

beforeEach(() => {
  sdk.put.mockReset().mockResolvedValue({ pathname: "backups/2026-07-29.json" });
  sdk.copy.mockReset().mockResolvedValue({
    pathname: "uploads/tool/plate-Xa9k2-Qm7p1.jpg",
    url: "https://store.public.blob.vercel-storage.com/uploads/tool/plate-Xa9k2-Qm7p1.jpg",
  });
  sdk.list.mockReset().mockResolvedValue({ blobs: [], hasMore: false });
  sdk.del.mockReset().mockResolvedValue(undefined);
});

describe("isBlobConfigured", () => {
  it("is false without a token, so a caller can fail loudly instead of on the SDK", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(isBlobConfigured()).toBe(false);
  });

  it("is true once Vercel injects the token", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_test");
    expect(isBlobConfigured()).toBe(true);
  });
});

describe("put", () => {
  // The backup dump carries student names and reporter email addresses from
  // Maintenance_Logs. A public blob URL is unauthenticated and permanent, so
  // this is the assertion that matters most in the file.
  it("ALWAYS writes privately — there is no parameter that can make it public", async () => {
    await getBlobStore().put("backups/2026-07-29.json", "{}", "application/json");

    expect(sdk.put).toHaveBeenCalledTimes(1);
    const [, , options] = sdk.put.mock.calls[0];
    expect(options.access).toBe("private");
  });

  it("keeps the exact pathname, because the pathname is the retention key", async () => {
    await getBlobStore().put("backups/2026-07-29.json", "{}", "application/json");

    const [pathname, body, options] = sdk.put.mock.calls[0];
    expect(pathname).toBe("backups/2026-07-29.json");
    expect(body).toBe("{}");
    expect(options.contentType).toBe("application/json");
    // A random suffix would leave the prune step unable to recognise its own
    // files, and a same-day re-run has to replace rather than throw.
    expect(options.addRandomSuffix).toBe(false);
    expect(options.allowOverwrite).toBe(true);
  });
});

describe("putUpload", () => {
  beforeEach(() => {
    sdk.put.mockResolvedValue({
      pathname: "uploads/broken-bed-Xa9k2.png",
      url: "https://store.public.blob.vercel-storage.com/uploads/broken-bed-Xa9k2.png",
    });
  });

  function photo(name = "broken bed.png", type = "image/png") {
    return new File([new Uint8Array([1, 2, 3])], name, { type });
  }

  it("stores an upload at a RANDOM pathname, so an unpublished image is unguessable", async () => {
    await getBlobStore().putUpload("uploads/project/", photo(), "public");

    const [pathname, , options] = sdk.put.mock.calls[0];
    // The stem is readable, the entropy is the SDK's; the caller records the
    // pathname that comes back, never the one it asked for.
    expect(pathname).toBe("uploads/project/broken-bed.png");
    expect(options.addRandomSuffix).toBe(true);
  });

  it("returns the pathname the store chose, not the one requested", async () => {
    const stored = await getBlobStore().putUpload(
      "uploads/project/",
      photo(),
      "public"
    );

    expect(stored.pathname).toBe("uploads/broken-bed-Xa9k2.png");
    expect(stored.url).toContain("broken-bed-Xa9k2.png");
  });

  it("honours the caller's access, because a maintenance photo may show a person", async () => {
    const store = getBlobStore();
    await store.putUpload("uploads/maintenance/", photo(), "private");
    await store.putUpload("uploads/project/", photo(), "public");

    expect(sdk.put.mock.calls[0][2].access).toBe("private");
    expect(sdk.put.mock.calls[1][2].access).toBe("public");
  });

  it("keeps the file's own content type so a browser renders it", async () => {
    await getBlobStore().putUpload(
      "uploads/resource/",
      photo("manual.pdf", "application/pdf"),
      "public"
    );

    expect(sdk.put.mock.calls[0][2].contentType).toBe("application/pdf");
  });

  it("strips path separators out of an untrusted filename", async () => {
    await getBlobStore().putUpload(
      "uploads/project/",
      photo("../../etc/passwd.png"),
      "public"
    );

    // The name is whatever the browser sent; it must not be able to move the
    // file out of its prefix.
    expect(sdk.put.mock.calls[0][0]).toBe("uploads/project/etc-passwd.png");
  });

  it("falls back to a name rather than writing a bare prefix", async () => {
    await getBlobStore().putUpload("uploads/chat/", photo("", ""), "private");

    expect(sdk.put.mock.calls[0][0]).toBe("uploads/chat/upload");
    expect(sdk.put.mock.calls[0][2].contentType).toBe(
      "application/octet-stream"
    );
  });
});

describe("copyToPublic", () => {
  it("copies to a PUBLIC, random pathname under the prefix, keeping the file name", async () => {
    await getBlobStore().copyToPublic("uploads/chat/plate-Xa9k2.jpg", "uploads/tool/");

    expect(sdk.copy).toHaveBeenCalledTimes(1);
    const [from, to, options] = sdk.copy.mock.calls[0];
    expect(from).toBe("uploads/chat/plate-Xa9k2.jpg");
    expect(to).toBe("uploads/tool/plate-Xa9k2.jpg");
    expect(options.access).toBe("public");
    // A photo on an unpublished pending tool must not be guessable.
    expect(options.addRandomSuffix).toBe(true);
  });

  it("returns the pathname and URL the store chose", async () => {
    const stored = await getBlobStore().copyToPublic(
      "uploads/chat/plate-Xa9k2.jpg",
      "uploads/tool/"
    );

    expect(stored).toEqual({
      pathname: "uploads/tool/plate-Xa9k2-Qm7p1.jpg",
      url: "https://store.public.blob.vercel-storage.com/uploads/tool/plate-Xa9k2-Qm7p1.jpg",
    });
  });

  it("never deletes the source — the caller does, once the row points at the copy", async () => {
    await getBlobStore().copyToPublic("uploads/chat/plate-Xa9k2.jpg", "uploads/tool/");
    expect(sdk.del).not.toHaveBeenCalled();
  });

  it("lets a refused copy reject rather than report a URL it does not have", async () => {
    sdk.copy.mockRejectedValueOnce(new Error("access denied"));
    await expect(
      getBlobStore().copyToPublic("uploads/chat/plate-Xa9k2.jpg", "uploads/tool/")
    ).rejects.toThrow("access denied");
  });
});

describe("list", () => {
  it("follows the cursor to the end and normalizes uploadedAt to ISO", async () => {
    sdk.list
      .mockResolvedValueOnce({
        blobs: [{ pathname: "backups/a.json", uploadedAt: new Date(0) }],
        hasMore: true,
        cursor: "c1",
      })
      .mockResolvedValueOnce({
        blobs: [{ pathname: "backups/b.json", uploadedAt: new Date(86_400_000) }],
        hasMore: false,
      });

    const blobs = await getBlobStore().list("backups/");

    expect(sdk.list).toHaveBeenCalledTimes(2);
    expect(sdk.list.mock.calls[1][0].cursor).toBe("c1");
    expect(blobs).toEqual([
      { pathname: "backups/a.json", uploadedAt: "1970-01-01T00:00:00.000Z" },
      { pathname: "backups/b.json", uploadedAt: "1970-01-02T00:00:00.000Z" },
    ]);
  });

  it("stops at the page cap rather than looping forever on a lying hasMore", async () => {
    sdk.list.mockResolvedValue({
      blobs: [{ pathname: "backups/x.json", uploadedAt: new Date(0) }],
      hasMore: true,
      cursor: "always-more",
    });

    const blobs = await getBlobStore().list("backups/");

    expect(sdk.list).toHaveBeenCalledTimes(20);
    expect(blobs).toHaveLength(20);
  });
});

describe("del", () => {
  it("does not call the SDK when there is nothing to prune", async () => {
    await getBlobStore().del([]);
    expect(sdk.del).not.toHaveBeenCalled();
  });

  it("passes the pathnames through in one call", async () => {
    await getBlobStore().del(["backups/a.json", "backups/b.json"]);
    expect(sdk.del).toHaveBeenCalledExactlyOnceWith([
      "backups/a.json",
      "backups/b.json",
    ]);
  });
});
