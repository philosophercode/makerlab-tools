// The Vercel Blob SDK talks to a signed API and would need a real token, so it
// is mocked at the module boundary. `vi.hoisted` because the `vi.mock` factory
// runs before module scope exists.
const sdk = vi.hoisted(() => ({
  put: vi.fn(),
  list: vi.fn(),
  del: vi.fn(),
}));

vi.mock("@vercel/blob", () => ({
  put: sdk.put,
  list: sdk.list,
  del: sdk.del,
}));

import { getBlobStore, isBlobConfigured } from "./blob";

beforeEach(() => {
  sdk.put.mockReset().mockResolvedValue({ pathname: "backups/2026-07-29.json" });
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
