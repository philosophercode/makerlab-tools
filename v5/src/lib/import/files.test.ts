import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { FileCopyError, createFileCopier, isStaleFileUrl, safeFilename, type BlobUploader } from "./files";

function memoryUploader() {
  const stored: Array<{ pathname: string; bytes: Uint8Array; access: string; contentType?: string }> = [];
  const uploader: BlobUploader = {
    async put(pathname, body, options) {
      stored.push({ pathname, bytes: body, access: options.access, contentType: options.contentType });
      return { pathname: `${pathname}-abc123`, url: `https://blob.test/${pathname}-abc123` };
    },
  };
  return { uploader, stored };
}

describe("createFileCopier", () => {
  it("downloads the bytes and uploads them under the requested pathname and access", async () => {
    server.use(
      http.get("https://files.notion.so/fresh/form4.png", () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3]).buffer, { headers: { "content-type": "image/png" } })
      )
    );
    const { uploader, stored } = memoryUploader();
    const copier = createFileCopier(uploader);

    const copied = await copier.copy("https://files.notion.so/fresh/form4.png", {
      pathname: "tools/abc/form4.png",
      access: "public",
    });

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ pathname: "tools/abc/form4.png", access: "public", contentType: "image/png" });
    expect(Array.from(stored[0].bytes)).toEqual([1, 2, 3]);
    expect(copied).toEqual({
      blobPathname: "tools/abc/form4.png-abc123",
      publicUrl: "https://blob.test/tools/abc/form4.png-abc123",
      contentType: "image/png",
      sizeBytes: 3,
    });
  });

  it("returns no public URL for a private file", async () => {
    server.use(http.get("https://example.com/photo.jpg", () => HttpResponse.arrayBuffer(new Uint8Array([9]).buffer)));
    const { uploader } = memoryUploader();
    const copied = await createFileCopier(uploader).copy("https://example.com/photo.jpg", {
      pathname: "maintenance/x/photo.jpg",
      access: "private",
    });
    expect(copied.publicUrl).toBeNull();
  });

  it("throws a FileCopyError with the status on a failed download and uploads nothing", async () => {
    server.use(http.get("https://example.com/gone.pdf", () => new HttpResponse(null, { status: 404 })));
    const { uploader, stored } = memoryUploader();
    await expect(
      createFileCopier(uploader).copy("https://example.com/gone.pdf", { pathname: "x/gone.pdf", access: "public" })
    ).rejects.toMatchObject({ name: "FileCopyError", status: 404 });
    expect(stored).toHaveLength(0);
  });

  it("refuses an empty download", async () => {
    server.use(http.get("https://example.com/empty.bin", () => HttpResponse.arrayBuffer(new ArrayBuffer(0))));
    const { uploader } = memoryUploader();
    await expect(
      createFileCopier(uploader).copy("https://example.com/empty.bin", { pathname: "x/empty.bin", access: "public" })
    ).rejects.toBeInstanceOf(FileCopyError);
  });
});

describe("isStaleFileUrl", () => {
  it("recognises the dead Airtable host", () => {
    expect(isStaleFileUrl("https://v5.airtableusercontent.com/stale/form4.png")).toBe(true);
    expect(isStaleFileUrl("https://files.notion.so/fresh/form4.png")).toBe(false);
  });
});

describe("safeFilename", () => {
  it("keeps the last path segment and strips anything unsafe", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("Form 4 (manual).pdf")).toBe("Form-4-manual-.pdf");
    expect(safeFilename("")).toBe("file");
  });
});
