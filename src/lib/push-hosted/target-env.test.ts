// @vitest-environment node
import { parseEnvFile, resolveTargetCredentials, secretScrubber } from "./target-env.ts";

/** The hosted env file: parsed, credentials picked, values never printed. Fake values only. */

const FILE = [
  "# Created by Vercel CLI",
  'DATABASE_URL="postgresql://owner:pw-fake-123@ep-fake.neon.example/db?sslmode=require"',
  'BLOB_STORE_ID="store_fakeStore"',
  'VERCEL_OIDC_TOKEN="eyJfake.oidc.token"',
  "export PLAIN=value # comment",
  "SINGLE='a b'",
  "",
].join("\n");

describe("parseEnvFile", () => {
  it("reads quoted, exported and commented lines", () => {
    const env = parseEnvFile(FILE);
    expect(env.DATABASE_URL).toBe("postgresql://owner:pw-fake-123@ep-fake.neon.example/db?sslmode=require");
    expect(env.PLAIN).toBe("value");
    expect(env.SINGLE).toBe("a b");
  });
});

describe("resolveTargetCredentials", () => {
  it("uses OIDC when the store is linked by id", () => {
    const creds = resolveTargetCredentials(parseEnvFile(FILE));
    expect(creds.databaseVar).toBe("DATABASE_URL");
    expect(creds.blob).toEqual({ kind: "oidc", storeId: "store_fakeStore", oidcToken: "eyJfake.oidc.token" });
  });

  it("prefers a read-write token, and the unpooled connection", () => {
    const creds = resolveTargetCredentials({
      DATABASE_URL: "postgres://a:b@pooled/db",
      DATABASE_URL_UNPOOLED: "postgres://a:b@direct/db",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_fake_x",
      BLOB_STORE_ID: "store_x",
      VERCEL_OIDC_TOKEN: "t",
    });
    expect(creds.databaseVar).toBe("DATABASE_URL_UNPOOLED");
    expect(creds.blob).toEqual({ kind: "token", token: "vercel_blob_rw_fake_x" });
  });

  it("reads a private store linked with the BLOB_PRIVATE prefix, or none", () => {
    const both = resolveTargetCredentials({
      DATABASE_URL: "postgres://u:p@h/db",
      BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_public_x",
      BLOB_PRIVATE_READ_WRITE_TOKEN: "vercel_blob_rw_private_y",
    });
    expect(both.privateBlob).toEqual({ kind: "token", token: "vercel_blob_rw_private_y" });
    expect(both.privateBlobVar).toBe("BLOB_PRIVATE_READ_WRITE_TOKEN");
    const one = resolveTargetCredentials({ DATABASE_URL: "postgres://u:p@h/db", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_public_x" });
    expect(one.privateBlob).toBeNull();
  });

  it("has no Blob store without either credential, and needs a database", () => {
    expect(resolveTargetCredentials({ DATABASE_URL: "postgres://a:b@h/db" }).blob).toBeNull();
    expect(() => resolveTargetCredentials({})).toThrow(/no DATABASE_URL/);
    expect(() => resolveTargetCredentials({ DATABASE_URL: "mysql://x" })).toThrow(/not a postgres/);
  });

  it("names variables, never values, in its errors", () => {
    try {
      resolveTargetCredentials({ DATABASE_URL: "not-a-url-secret-value" });
    } catch (error) {
      expect((error as Error).message).not.toContain("secret-value");
    }
  });
});

describe("secretScrubber", () => {
  it("removes every value, and the parts of a connection string", () => {
    const scrub = secretScrubber(parseEnvFile(FILE));
    const text = scrub(
      "connect to ep-fake.neon.example failed for owner with pw-fake-123; token eyJfake.oidc.token; " +
        "url postgresql://owner:pw-fake-123@ep-fake.neon.example/db?sslmode=require"
    );
    expect(text).not.toContain("pw-fake-123");
    expect(text).not.toContain("ep-fake.neon.example");
    expect(text).not.toContain("eyJfake.oidc.token");
    expect(text).toContain("[redacted]");
  });
});
