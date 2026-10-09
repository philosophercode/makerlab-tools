import { readFileSync } from "node:fs";
import { blobImagePatterns, publicBlobStoreId } from "./remote-patterns";

describe("blobImagePatterns — the optimizer's remote hosts", () => {
  it("names the store a store id links, lower-cased and without its prefix", () => {
    expect(blobImagePatterns({ BLOB_STORE_ID: "store_EhLhvy4tR3ZpoSoU" })).toEqual([
      { protocol: "https", hostname: "ehlhvy4tr3zposou.public.blob.vercel-storage.com" },
    ]);
  });

  it("reads only the id from a read-write token, never its secret", () => {
    const patterns = blobImagePatterns({ BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_AbC123_sEcReTpart" });
    expect(patterns).toEqual([{ protocol: "https", hostname: "abc123.public.blob.vercel-storage.com" }]);
    expect(JSON.stringify(patterns)).not.toContain("sEcReT");
  });

  it("prefers the store id when both are set", () => {
    expect(publicBlobStoreId({ BLOB_STORE_ID: "store_one", BLOB_READ_WRITE_TOKEN: "vercel_blob_rw_two_x" })).toBe("one");
  });

  it("names nothing when no store is linked or the credential is malformed", () => {
    expect(blobImagePatterns({})).toEqual([]);
    expect(blobImagePatterns({ BLOB_READ_WRITE_TOKEN: "not-a-token" })).toEqual([]);
    expect(blobImagePatterns({ BLOB_STORE_ID: "store_*" })).toEqual([]);
  });
});

describe("next.config.ts images.remotePatterns", () => {
  // The exported config is a function (withWorkflow), so its source is checked:
  // no wildcard Blob host, and no S3, Unsplash or Airtable host, may come back.
  const source = readFileSync("next.config.ts", "utf8");

  it("takes its Blob host from blobImagePatterns, never a wildcard or a third-party host", () => {
    expect(source).toContain("...blobImagePatterns(process.env)");
    expect(source).not.toMatch(/hostname:\s*"[^"]*\*/);
    expect(source).not.toMatch(/hostname:\s*"[^"]*(amazonaws\.com|unsplash\.com|airtableusercontent\.com)"/);
  });
});
