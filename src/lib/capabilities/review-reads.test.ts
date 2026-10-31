// @vitest-environment node
import type { MakerLabTool } from "../../components/catalog-types";
import type { ViewPhotoResult } from "./review-reads";

const mocks = vi.hoisted(() => ({
  getCatalogTool: vi.fn(),
  guardedFetch: vi.fn(),
  read: vi.fn(),
  mode: vi.fn(() => "vercel"),
}));

vi.mock("../catalog", () => ({ getCatalogTool: mocks.getCatalogTool }));
vi.mock("../web/guarded-fetch", () => ({ guardedFetch: mocks.guardedFetch }));
vi.mock("../blob", () => ({ getBlobStore: () => ({ read: mocks.read }), isBlobConfigured: () => true }));
vi.mock("../blob-mode", () => ({ blobMode: mocks.mode }));

const { reviewReadTools } = await import("./review-reads");

/**
 * `view_tool_photo` — a published tool's photo as an MCP image part. The
 * catalogue and the guarded download are stubbed; the downscale is real.
 */

const view = reviewReadTools.find((t) => t.name === "view_tool_photo")!;

/** A real 4×3 PNG, made with sharp so the inspector and the downscale accept it. */
async function png(): Promise<Uint8Array> {
  const sharp = (await import("sharp")).default;
  const out = await sharp({ create: { width: 4, height: 3, channels: 3, background: "#c00" } }).png().toBuffer();
  return new Uint8Array(out);
}

function catalogTool(imageSrc: string): Partial<MakerLabTool> {
  return { id: "t1", slug: "form-4", name: "Form 4", imageSrc };
}

beforeEach(() => {
  mocks.getCatalogTool.mockReset();
  mocks.guardedFetch.mockReset();
  mocks.read.mockReset();
  mocks.mode.mockReturnValue("vercel");
  vi.stubEnv("AUTH_BASE_URL", "http://localhost:3000");
});

describe("view_tool_photo", () => {
  it("answers a tool's photo as a text part and an image part", async () => {
    mocks.getCatalogTool.mockResolvedValue(catalogTool("https://store.example/form-4.png"));
    mocks.guardedFetch.mockResolvedValue({ ok: true, bytes: await png() });

    const result = (await view.run({ tool: "form-4" }, {})) as ViewPhotoResult;
    expect(result).toMatchObject({ found: true, subject: "Form 4", source_url: "https://store.example/form-4.png", width: 4, height: 3 });
    expect(mocks.guardedFetch).toHaveBeenCalledWith("https://store.example/form-4.png", expect.any(Object));

    const parts = view.toMcpContent!(result);
    expect(parts.map((p) => p.type)).toEqual(["text", "image"]);
    expect(parts[0].type === "text" && parts[0].text).not.toContain("data");
    expect(parts[1]).toMatchObject({ type: "image", mimeType: "image/jpeg" });
  });

  it("says so when the tool has no photo, without fetching anything", async () => {
    mocks.getCatalogTool.mockResolvedValue(catalogTool(""));
    const result = (await view.run({ tool: "form-4" }, {})) as ViewPhotoResult;
    expect(result).toEqual({ found: false, message: "Form 4 has no photo." });
    expect(mocks.guardedFetch).not.toHaveBeenCalled();
    expect(view.toMcpContent!(result).map((p) => p.type)).toEqual(["text"]);
  });

  it("reads a local disk-store photo from the store, never through the guarded reader", async () => {
    mocks.mode.mockReturnValue("local");
    mocks.getCatalogTool.mockResolvedValue(catalogTool("http://localhost:3000/api/dev-blob/uploads/tool/form%204.png"));
    mocks.read.mockResolvedValue({ body: await png(), contentType: "image/png" });

    expect(await view.run({ tool: "form-4" }, {})).toMatchObject({ found: true, width: 4, height: 3 });
    expect(mocks.read).toHaveBeenCalledWith("uploads/tool/form 4.png", "public");
    expect(mocks.guardedFetch).not.toHaveBeenCalled();
  });

  it("says so when the download fails", async () => {
    mocks.getCatalogTool.mockResolvedValue(catalogTool("https://store.example/form-4.png"));
    mocks.guardedFetch.mockResolvedValue({ ok: false, reason: "http_error" });
    expect(await view.run({ tool: "form-4" }, {})).toMatchObject({ found: false });
  });

  it("asks for exactly one of a tool or an intake item", async () => {
    expect(await view.run({}, {})).toMatchObject({ found: false, message: "Name either a tool or an intake_item." });
    expect(await view.run({ tool: "a", intake_item: "b" }, {})).toMatchObject({ found: false });
  });

  it("is MCP only and gated on tools.approve, like the other review read", () => {
    for (const tool of reviewReadTools) {
      expect(tool.mcpOnly).toBe(true);
      expect(tool.requiredPermission).toBe("tools.approve");
      expect(tool.kind).toBe("read");
    }
  });
});
