import { blobCredentials, blobMode, hasPrivateBlobStore } from "./blob-mode";

/**
 * The one rule for which Blob store a process uses. vitest.setup.ts sets
 * `BLOB_LOCAL_DISABLE=1` for the suite, so every row states it explicitly.
 */
function env(vars: {
  token?: string;
  storeId?: string;
  vercel?: string;
  nodeEnv?: string;
  disable?: string;
  dir?: string;
}) {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", vars.token ?? "");
  vi.stubEnv("BLOB_STORE_ID", vars.storeId ?? "");
  vi.stubEnv("VERCEL", vars.vercel ?? "");
  vi.stubEnv("NODE_ENV", vars.nodeEnv ?? "development");
  vi.stubEnv("BLOB_LOCAL_DISABLE", vars.disable ?? "");
  vi.stubEnv("BLOB_LOCAL_DIR", vars.dir ?? "");
}

describe("blobMode", () => {
  it("is vercel whenever a token is set, wherever it runs", () => {
    env({ token: "vercel_blob_rw_test" });
    expect(blobMode()).toBe("vercel");
    env({ token: "vercel_blob_rw_test", vercel: "1", nodeEnv: "production" });
    expect(blobMode()).toBe("vercel");
  });

  it("is vercel for a store linked by BLOB_STORE_ID (OIDC), with no token", () => {
    env({ storeId: "store_test", vercel: "1", nodeEnv: "production" });
    expect(blobMode()).toBe("vercel");
  });

  it("is none on Vercel without a token — a deploy never falls back to disk", () => {
    env({ vercel: "1" });
    expect(blobMode()).toBe("none");
  });

  it("is none in a production build without a token", () => {
    env({ nodeEnv: "production" });
    expect(blobMode()).toBe("none");
  });

  it("is local in a production build only when BLOB_LOCAL_DIR names a folder (the E2E server)", () => {
    env({ nodeEnv: "production", dir: ".blob-data-e2e" });
    expect(blobMode()).toBe("local");
    env({ nodeEnv: "production", dir: "   " });
    expect(blobMode()).toBe("none");
  });

  it("never honours BLOB_LOCAL_DIR on Vercel", () => {
    env({ vercel: "1", nodeEnv: "production", dir: ".blob-data-e2e" });
    expect(blobMode()).toBe("none");
  });

  it("still lets BLOB_LOCAL_DISABLE switch the store off with BLOB_LOCAL_DIR set", () => {
    env({ nodeEnv: "production", dir: ".blob-data-e2e", disable: "1" });
    expect(blobMode()).toBe("none");
  });

  it("is local in development without a token", () => {
    env({});
    expect(blobMode()).toBe("local");
    env({ nodeEnv: "test" });
    expect(blobMode()).toBe("local");
  });

  it("is none when BLOB_LOCAL_DISABLE is set", () => {
    env({ disable: "1" });
    expect(blobMode()).toBe("none");
    env({ disable: "true" });
    expect(blobMode()).toBe("none");
  });

  it("treats BLOB_LOCAL_DISABLE=0 / false as not disabled", () => {
    env({ disable: "0" });
    expect(blobMode()).toBe("local");
    env({ disable: "false" });
    expect(blobMode()).toBe("local");
  });

  it("is none by default in the test suite", () => {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    expect(blobMode()).toBe("none");
  });
});

/**
 * Two stores (blob stores amendment, 2026-09-27): a Vercel Blob store is
 * either all-public or all-private, so private files may live in a second
 * store connected with the prefix `BLOB_PRIVATE`.
 */
describe("blobCredentials", () => {
  function stores(vars: { privateToken?: string; privateStoreId?: string }) {
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_public");
    vi.stubEnv("BLOB_STORE_ID", "store_public");
    vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", vars.privateToken ?? "");
    vi.stubEnv("BLOB_PRIVATE_STORE_ID", vars.privateStoreId ?? "");
  }

  it("with one store, adds nothing for either access — the SDK default, exactly as before", () => {
    stores({});
    expect(hasPrivateBlobStore()).toBe(false);
    expect(blobCredentials("public")).toEqual({});
    expect(blobCredentials("private")).toEqual({});
  });

  it("sends private files to the private store's read-write token", () => {
    stores({ privateToken: "vercel_blob_rw_private" });
    expect(hasPrivateBlobStore()).toBe(true);
    expect(blobCredentials("private")).toEqual({ token: "vercel_blob_rw_private" });
  });

  it("sends private files to the private store id (OIDC) when there is no private token", () => {
    stores({ privateStoreId: "store_private" });
    expect(hasPrivateBlobStore()).toBe(true);
    expect(blobCredentials("private")).toEqual({ storeId: "store_private" });
  });

  it("prefers the private token over the private store id, since a token cannot be shadowed", () => {
    stores({ privateToken: " vercel_blob_rw_private ", privateStoreId: "store_private" });
    expect(blobCredentials("private")).toEqual({ token: "vercel_blob_rw_private" });
  });

  it("never sends a public file to the private store", () => {
    stores({ privateToken: "vercel_blob_rw_private", privateStoreId: "store_private" });
    expect(blobCredentials("public")).toEqual({});
  });

  it("leaves blobMode alone: a private store by itself is no place for public files", () => {
    env({ vercel: "1" });
    vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "vercel_blob_rw_private");
    expect(blobMode()).toBe("none");
  });
});
