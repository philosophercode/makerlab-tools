import type { MakerLabTool } from "../../../components/catalog-types";

vi.mock("../../../lib/catalog", () => ({ getCatalogTool: vi.fn() }));

import { getCatalogTool } from "../../../lib/catalog";
import { toolPageMetadata } from "./metadata";

/**
 * A tool page's title and link preview (`generateMetadata` → `toolPageMetadata`).
 *
 * `getCatalogTool` is the page's own cached, published-only read, so a draft
 * and a slug nobody owns both arrive here as null — and must both come back
 * as the site's generic metadata, so a shared draft link names nothing.
 */

const BLOB_PHOTO = "https://abc123.public.blob.vercel-storage.com/tools/form-4-x1y2.png";

function tool(overrides: Partial<MakerLabTool> = {}): MakerLabTool {
  return {
    id: "8a0c6a4e-0d3f-4a55-9d3a-0d0e2d7f0b11",
    slug: "form-4",
    name: "Form 4",
    category: "3D Printing",
    categorySub: "Resin printers",
    location: "",
    zone: "",
    trainingLevel: "Beginner",
    trainingLabel: "",
    status: "Available",
    shortDescription: "A resin 3D printer for fine, smooth parts.",
    description: "The Form 4 is a masked-stereolithography printer.",
    imageSrc: BLOB_PHOTO,
    thumbnails: { base: "https://abc123.public.blob.vercel-storage.com/thumbs/x", widths: [160, 320, 640], width: 1600, height: 1200 },
    ppe: [],
    materials: [],
    tags: [],
    emergencyStop: null,
    useRestrictions: null,
    mapId: null,
    notes: null,
    links: [],
    units: [],
    ...overrides,
  } as MakerLabTool;
}

describe("toolPageMetadata", () => {
  beforeEach(() => vi.mocked(getCatalogTool).mockReset());

  it("titles the page with the tool's name and shows its photo, resized, in the preview", async () => {
    vi.mocked(getCatalogTool).mockResolvedValue(tool());

    const metadata = await toolPageMetadata("form-4");

    const image = `/_next/image?url=${encodeURIComponent(BLOB_PHOTO)}&w=640&q=75`;
    expect(metadata.title).toBe("Form 4");
    expect(metadata.description).toBe("A resin 3D printer for fine, smooth parts.");
    expect(metadata.openGraph).toMatchObject({
      title: "Form 4",
      description: "A resin 3D printer for fine, smooth parts.",
      url: "/tools/form-4",
      siteName: "MakerLAB Tools",
      type: "website",
      images: [{ url: image, width: 640, height: 480, alt: "Form 4" }],
    });
    expect(metadata.twitter).toMatchObject({ card: "summary_large_image", title: "Form 4", images: [image] });
    expect(getCatalogTool).toHaveBeenCalledWith("form-4");
  });

  it("uses the long description, cut to one line, when there is no short one", async () => {
    const long = "The Form 4 is a masked-stereolithography printer that cures each layer at once. ".repeat(4);
    vi.mocked(getCatalogTool).mockResolvedValue(tool({ shortDescription: "", description: long }));

    const { description } = await toolPageMetadata("form-4");

    expect(typeof description).toBe("string");
    expect((description as string).length).toBeLessThanOrEqual(160);
    expect(description).toMatch(/^The Form 4 is a masked-stereolithography printer/);
    expect(description).toMatch(/…$/);
  });

  it("falls back to the site card when the tool has no photo", async () => {
    vi.mocked(getCatalogTool).mockResolvedValue(tool({ imageSrc: "", thumbnails: null, shortDescription: "", description: "" }));

    const metadata = await toolPageMetadata("form-4");

    expect(metadata.title).toBe("Form 4");
    expect(metadata.description).toBe("3D Printing at the Cornell Tech MakerLAB.");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/opengraph-image", width: 1200, height: 630 })]);
    expect(metadata.twitter).toMatchObject({ images: ["/opengraph-image"] });
  });

  it("never shares a photo that is not in the public store", async () => {
    vi.mocked(getCatalogTool).mockResolvedValue(
      tool({ imageSrc: "https://abc123.private.blob.vercel-storage.com/tools/form-4.png", thumbnails: null })
    );

    const metadata = await toolPageMetadata("form-4");

    expect(JSON.stringify(metadata)).not.toContain("private.blob");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/opengraph-image" })]);
  });

  it("gives a draft, an archived tool or an unknown slug the site's generic metadata", async () => {
    vi.mocked(getCatalogTool).mockResolvedValue(null);

    expect(await toolPageMetadata("secret-draft")).toEqual({});
    expect(await toolPageMetadata("2f1c0d6e8a7b4c3d9e0f1a2b3c4d5e6f")).toEqual({});
  });
});
