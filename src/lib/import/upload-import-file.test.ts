import { IMPORT_DIRECT_UPLOAD_MAX_BYTES } from "./limits";
import { safeName, uploadImportFile } from "./upload-import-file";

/**
 * The browser's one way to upload a list (import progress spec 2026-10-27
 * §3.5): small files through `POST /api/uploads`, larger ones straight to Blob,
 * and back to the function where a direct upload cannot be signed.
 */

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function fileOf(size: number, name = "tools.csv", type = "text/csv"): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("uploadImportFile", () => {
  it("sends a file under the body limit through /api/uploads, kind import", async () => {
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      expect((init?.body as FormData).get("kind")).toBe("import");
      return json(200, { attachmentId: "att-1", name: "tools.csv" });
    });
    const upload = vi.fn();
    const result = await uploadImportFile(fileOf(1000), { fetcher: fetcher as never, upload: upload as never });
    expect(result).toEqual({ ok: true, attachmentId: "att-1", name: "tools.csv" });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/uploads"]);
    expect(upload).not.toHaveBeenCalled();
  });

  it("sends a larger file straight to Blob in the caller's folder, then records it", async () => {
    const calls: unknown[] = [];
    const fetcher = vi.fn(async (url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      calls.push([url, body.type]);
      if (body.type === "import.folder") return json(200, { prefix: "uploads/import/u1/" });
      return json(200, { attachmentId: "att-2", name: body.name });
    });
    const upload = vi.fn(async (pathname: string, _body: unknown, _options: unknown) => ({ pathname: `${pathname.replace(".csv", "")}-Xa9k2.csv` }));
    const result = await uploadImportFile(fileOf(IMPORT_DIRECT_UPLOAD_MAX_BYTES + 1), { fetcher: fetcher as never, upload: upload as never });
    expect(result).toEqual({ ok: true, attachmentId: "att-2", name: "tools.csv" });
    expect(upload.mock.calls[0][0]).toBe("uploads/import/u1/tools.csv");
    expect(upload.mock.calls[0][2]).toMatchObject({ access: "private", handleUploadUrl: "/api/uploads/token", multipart: true });
    expect(calls).toEqual([
      ["/api/uploads/token", "import.folder"],
      ["/api/uploads/token", "import.complete"],
    ]);
  });

  it("falls back to /api/uploads where a direct upload cannot be signed, keeping the platform's answer", async () => {
    const fetcher = vi.fn(async (url: string) =>
      url === "/api/uploads/token" ? json(501, { code: "client_upload_unavailable" }) : new Response("Request Entity Too Large", { status: 413 })
    );
    const result = await uploadImportFile(fileOf(IMPORT_DIRECT_UPLOAD_MAX_BYTES + 1), { fetcher: fetcher as never, upload: vi.fn() as never });
    expect(result).toEqual({ ok: false, status: 413, code: undefined, error: undefined });
  });

  it("keeps a refusal's status and code, so each caller words it as before", async () => {
    const fetcher = vi.fn(async () => json(503, { code: "blob_not_configured" }));
    expect(await uploadImportFile(fileOf(10), { fetcher: fetcher as never })).toMatchObject({ ok: false, status: 503, code: "blob_not_configured" });
  });

  it("makes a safe last pathname segment of any file name", () => {
    expect(safeName("Lab inventory (2026).csv")).toBe("Lab-inventory-_2026_.csv");
    expect(safeName("../../etc/passwd")).toBe("_.._etc_passwd");
    expect(safeName("")).toBe("list.txt");
  });
});
