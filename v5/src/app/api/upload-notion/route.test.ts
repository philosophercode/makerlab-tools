import { server } from "../../../../test/msw/server";
import { http, HttpResponse } from "msw";

const NOTION = "https://api.notion.com/v1";

// Build a multipart POST request from a File. Passing a FormData body to
// Request sets the multipart content-type (with boundary) automatically.
let ipCounter = 0;
function uniqueIp() {
  ipCounter += 1;
  return `10.0.0.${ipCounter}`;
}

// Build a request-like object the route can consume. We avoid constructing a
// real multipart HTTP body because `Request.formData()` on a manually-built
// multipart body containing a File hangs under the jsdom/undici test runtime.
// The route only uses `req.headers.get(...)` (via getClientIp) and
// `await req.formData()`, so we provide exactly those.
function uploadRequest(file: File | null, { withFile = true } = {}) {
  const fd = new FormData();
  if (withFile && file) fd.append("file", file);
  return {
    headers: new Headers({ "x-forwarded-for": uniqueIp() }),
    formData: async () => fd,
  };
}

function pngFile(bytes = 10, name = "photo.png", type = "image/png") {
  return new File([new Uint8Array(bytes)], name, { type });
}

// Stub a NOTION_API_KEY for the happy/502 paths. (Env is auto-unstubbed after
// each test by the setup file.)
function stubNotionKey() {
  vi.stubEnv("NOTION_API_KEY", "secret_test");
}

describe("POST /api/upload-notion", () => {
  it("returns 429 when rate-limited", async () => {
    vi.doMock("@/lib/rate-limit", async () => {
      const actual = await vi.importActual<typeof import("@/lib/rate-limit")>(
        "@/lib/rate-limit"
      );
      return {
        ...actual,
        rateLimitAsync: vi.fn(async () => ({ allowed: false, remaining: 0 })),
      };
    });
    const { POST } = await import("./route");

    const res = await POST(uploadRequest(pngFile()) as never);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("60");
    const body = await res.json();
    expect(body.error).toMatch(/too many requests/i);

    vi.doUnmock("@/lib/rate-limit");
    vi.resetModules();
  });

  it("returns 500 when NOTION_API_KEY is unset", async () => {
    vi.stubEnv("NOTION_API_KEY", "");
    const { POST } = await import("./route");

    const res = await POST(uploadRequest(pngFile()) as never);
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Server misconfigured");
  });

  describe("400 cases", () => {
    it("rejects invalid / non-multipart form data", async () => {
      stubNotionKey();
      const { POST } = await import("./route");

      // Simulate a body that cannot be parsed as multipart form data:
      // req.formData() throws (mirrors undici on a non-multipart body).
      const req = {
        headers: new Headers({ "x-forwarded-for": uniqueIp() }),
        formData: async () => {
          throw new TypeError("Could not parse content as FormData.");
        },
      };
      const res = await POST(req as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Invalid form data");
    });

    it("rejects when file field is missing", async () => {
      stubNotionKey();
      const { POST } = await import("./route");

      const res = await POST(uploadRequest(null, { withFile: false }) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Missing file");
    });

    it("rejects a non-image file type", async () => {
      stubNotionKey();
      const { POST } = await import("./route");

      const file = new File([new Uint8Array(10)], "doc.txt", {
        type: "text/plain",
      });
      const res = await POST(uploadRequest(file) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Only image uploads are supported");
    });

    it("rejects a file larger than 18MB", async () => {
      stubNotionKey();
      const { POST } = await import("./route");

      // Construct a real File and override .size to exceed 18MB without
      // allocating ~18MB of memory. The route reads file.size for the check.
      const file = pngFile(10, "big.png");
      Object.defineProperty(file, "size", { value: 18 * 1024 * 1024 + 1 });
      const res = await POST(uploadRequest(file) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("File too large (max 18MB)");
    });

    it("rejects an empty (0-byte) file", async () => {
      stubNotionKey();
      const { POST } = await import("./route");

      const file = new File([], "empty.png", { type: "image/png" });
      const res = await POST(uploadRequest(file) as never);
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe("Empty file");
    });
  });

  it("happy path: two-stage flow returns file_upload_id and metadata", async () => {
    stubNotionKey();

    // Default handlers already cover create-session + send-bytes, but pin them
    // explicitly so the upload_url matches a handler we own.
    server.use(
      http.post(`${NOTION}/file_uploads`, () =>
        HttpResponse.json({
          id: "file-upload-xyz",
          object: "file_upload",
          status: "pending",
          upload_url: `${NOTION}/file_uploads/file-upload-xyz/send`,
        })
      ),
      http.post(`${NOTION}/file_uploads/:id/send`, ({ params }) =>
        HttpResponse.json({
          id: params.id as string,
          object: "file_upload",
          status: "uploaded",
        })
      )
    );

    const { POST } = await import("./route");
    const res = await POST(uploadRequest(pngFile(10, "photo.png")) as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      file_upload_id: "file-upload-xyz",
      name: "photo.png",
      contentType: "image/png",
      size: 10,
    });
  });

  describe("502 cases", () => {
    it("returns 502 when create-session is non-ok", async () => {
      stubNotionKey();
      server.use(
        http.post(`${NOTION}/file_uploads`, () =>
          HttpResponse.json(
            { object: "error", status: 401, code: "unauthorized" },
            { status: 401 }
          )
        )
      );

      const { POST } = await import("./route");
      const res = await POST(uploadRequest(pngFile()) as never);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("Upload session creation failed");
    });

    it("returns 502 when create-session is missing required fields", async () => {
      stubNotionKey();
      server.use(
        http.post(`${NOTION}/file_uploads`, () =>
          HttpResponse.json({ object: "file_upload", status: "pending" })
        )
      );

      const { POST } = await import("./route");
      const res = await POST(uploadRequest(pngFile()) as never);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("Upload session creation failed");
    });

    it("returns 502 when send-bytes is non-ok", async () => {
      stubNotionKey();
      server.use(
        http.post(`${NOTION}/file_uploads`, () =>
          HttpResponse.json({
            id: "file-upload-send-fail",
            object: "file_upload",
            status: "pending",
            upload_url: `${NOTION}/file_uploads/file-upload-send-fail/send`,
          })
        ),
        http.post(`${NOTION}/file_uploads/:id/send`, () =>
          HttpResponse.json(
            { object: "error", status: 500, code: "internal_server_error" },
            { status: 500 }
          )
        )
      );

      const { POST } = await import("./route");
      const res = await POST(uploadRequest(pngFile()) as never);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("Upload failed");
    });

    it("returns 502 on a network error during create-session", async () => {
      stubNotionKey();
      server.use(
        http.post(`${NOTION}/file_uploads`, () => HttpResponse.error())
      );

      const { POST } = await import("./route");
      const res = await POST(uploadRequest(pngFile()) as never);
      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.error).toBe("Upload session creation failed");
    });
  });
});
