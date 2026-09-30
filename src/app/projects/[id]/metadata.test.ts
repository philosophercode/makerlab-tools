import type { MakerLabProject } from "../../../components/catalog-types";

vi.mock("../../../lib/projects", () => ({ getProject: vi.fn() }));

import { getProject } from "../../../lib/projects";
import { projectPageMetadata } from "./metadata";

/** A project page's title and link preview (`generateMetadata` → `projectPageMetadata`). */

const COVER = "https://abc123.public.blob.vercel-storage.com/projects/lamp.jpg";

function project(overrides: Partial<MakerLabProject> = {}): MakerLabProject {
  return {
    id: "5b3f0a1c-2d4e-4f60-8a9b-0c1d2e3f4a5b",
    slug: "desk-lamp",
    title: "Desk lamp",
    author: "Ada",
    body: "A **laser-cut** plywood lamp with a 3D-printed shade.",
    photos: [COVER],
    tools: [],
    link: null,
    materials: [],
    date: null,
    ...overrides,
  };
}

describe("projectPageMetadata", () => {
  beforeEach(() => vi.mocked(getProject).mockReset());

  it("titles the page with the project and shows its cover", async () => {
    vi.mocked(getProject).mockResolvedValue(project());

    const metadata = await projectPageMetadata("desk-lamp");

    expect(metadata.title).toBe("Desk lamp");
    expect(metadata.description).toBe("A laser-cut plywood lamp with a 3D-printed shade.");
    expect(metadata.openGraph).toMatchObject({
      url: "/projects/desk-lamp",
      images: [{ url: `/_next/image?url=${encodeURIComponent(COVER)}&w=640&q=75`, alt: "Desk lamp" }],
    });
  });

  it("falls back to the site card and a byline when there is no photo or write-up", async () => {
    vi.mocked(getProject).mockResolvedValue(project({ photos: [], body: "" }));

    const metadata = await projectPageMetadata("desk-lamp");

    expect(metadata.description).toBe("A project by Ada, made in the Cornell Tech MakerLAB.");
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/opengraph-image" })]);
  });

  it("gives an unpublished or unknown project the site's generic metadata", async () => {
    vi.mocked(getProject).mockResolvedValue(null);
    expect(await projectPageMetadata("nope")).toEqual({});
  });
});
