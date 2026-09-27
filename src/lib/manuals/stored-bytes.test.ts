// The Vercel Blob SDK is mocked at the module boundary: no token, no network.
const sdk = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@vercel/blob", () => ({ get: sdk.get }));

import { readStoredFile } from "./stored-bytes";

/**
 * Reading a stored file back goes to the store that holds its access — blob
 * stores amendment, 2026-09-27.
 */
function streamOf(bytes: Uint8Array): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "vercel_blob_rw_public");
  vi.stubEnv("BLOB_PRIVATE_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_PRIVATE_STORE_ID", "");
  sdk.get.mockReset().mockImplementation(async () => ({ statusCode: 200, stream: streamOf(new Uint8Array([7])) }));
});

describe("readStoredFile", () => {
  it("with one store, reads either access with the SDK's default credentials", async () => {
    await readStoredFile("uploads/resource/sop.pdf", "private", 100);
    expect(sdk.get).toHaveBeenCalledExactlyOnceWith("uploads/resource/sop.pdf", { access: "private" });
  });

  it("with a private store, reads a private file from it and a public file from the default store", async () => {
    vi.stubEnv("BLOB_PRIVATE_STORE_ID", "store_private");
    const privateRead = await readStoredFile("uploads/import/list.csv", "private", 100);
    await readStoredFile("manuals/t/r.pdf", "public", 100);

    expect(privateRead).toEqual({ ok: true, bytes: new Uint8Array([7]) });
    expect(sdk.get.mock.calls[0][1]).toEqual({ storeId: "store_private", access: "private" });
    expect(sdk.get.mock.calls[1][1]).toEqual({ access: "public" });
  });
});
