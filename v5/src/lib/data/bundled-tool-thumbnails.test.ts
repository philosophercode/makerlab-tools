// @vitest-environment node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { THUMBNAIL_FORMATS, thumbnailUrl } from "../images/thumbnail-urls";
import { generateBundledThumbnails } from "../images/bundled-thumbnails";
import { BUNDLED_TOOL_IMAGES } from "./bundled-tool-images";
import { BUNDLED_TOOL_THUMBNAILS } from "./bundled-tool-thumbnails";

/**
 * The committed thumbnails match the committed photos. Fails when a PNG in
 * `public/tool-images/` was added, replaced or removed without re-running
 * `npm run thumbnails:bundled` (which fixes it).
 */
describe("BUNDLED_TOOL_THUMBNAILS", () => {
  it("has a set for every bundled photo, and nothing else", () => {
    expect(Object.keys(BUNDLED_TOOL_THUMBNAILS).sort()).toEqual([...BUNDLED_TOOL_IMAGES].sort());
  });

  it("names files that exist in public/tool-images/thumbs", () => {
    const missing = Object.values(BUNDLED_TOOL_THUMBNAILS).flatMap((set) =>
      set.widths.flatMap((w) =>
        THUMBNAIL_FORMATS.map((f) => thumbnailUrl(set, w, f)).filter((url) => !existsSync(join(process.cwd(), "public", url)))
      )
    );
    expect(missing).toEqual([]);
  });

  it("is up to date with the photos' content (npm run thumbnails:bundled -- --check)", async () => {
    const report = await generateBundledThumbnails({
      sourceDir: join(process.cwd(), "public/tool-images"),
      outDir: join(process.cwd(), "public/tool-images/thumbs"),
      urlPrefix: "/tool-images/thumbs",
      manifestPath: join(process.cwd(), "src/lib/data/bundled-tool-thumbnails.ts"),
      check: true,
    });
    expect(report.rendered).toEqual([]);
    expect(report.upToDate).toBe(true);
  });
});
