// The Vercel Blob SDK is mocked at the module boundary: no token, no network.
const sdk = vi.hoisted(() => ({ put: vi.fn() }));
vi.mock("@vercel/blob", () => ({ put: sdk.put }));

import { createVercelBlobUploader } from "./blob-uploader";

/**
 * Step code's uploader (manual archiver, research's cleaned copy, the Notion
 * import) routes by access the same way `lib/blob.ts` does — blob stores
 * amendment, 2026-09-27.
 */
beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_public");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_PRIVATE_STORE_ID", "");
  sdk.put.mockReset().mockResolvedValue({ pathname: "p", url: "https://x/p" });
});

const bytes = new Uint8Array([1, 2, 3]);

describe("createVercelBlobUploader", () => {
  it("with one store, writes both kinds with the SDK's default credentials", async () => {
    const uploader = createVercelBlobUploader();
    await uploader.put("research/cleaned/a.png", bytes, { access: "private", contentType: "image/png" });
    await uploader.put("manuals/t/r.pdf", bytes, { access: "public", contentType: "application/pdf" });

    for (const call of sdk.put.mock.calls) {
      expect(call[2].token).toBeUndefined();
      expect(call[2].storeId).toBeUndefined();
    }
  });

  it("with a private store, sends a private file there and a public file to the default store", async () => {
    vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "vercel_blob_rw_private");
    const uploader = createVercelBlobUploader();
    await uploader.put("research/cleaned/a.png", bytes, { access: "private", contentType: "image/png" });
    await uploader.put("manuals/t/r.pdf", bytes, { access: "public", contentType: "application/pdf" });

    expect(sdk.put.mock.calls[0][2]).toMatchObject({ token: "vercel_blob_rw_private", access: "private" });
    expect(sdk.put.mock.calls[1][2]).toMatchObject({ access: "public" });
    expect(sdk.put.mock.calls[1][2].token).toBeUndefined();
  });
});
