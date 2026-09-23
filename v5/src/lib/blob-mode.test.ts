import { blobMode } from "./blob-mode";

/**
 * The one rule for which Blob store a process uses. vitest.setup.ts sets
 * `BLOB_LOCAL_DISABLE=1` for the suite, so every row states it explicitly.
 */
function env(vars: {
  token?: string;
  vercel?: string;
  nodeEnv?: string;
  disable?: string;
  dir?: string;
}) {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", vars.token ?? "");
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
