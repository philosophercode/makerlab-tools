import {
  isImageThumbnails,
  plannedWidths,
  thumbnailBlobPathnames,
  thumbnailFallbackSrc,
  thumbnailSrcSet,
  thumbnailUrl,
  type ImageThumbnails,
} from "./thumbnail-urls";

const SET: ImageThumbnails = { base: "/tool-images/thumbs/form-4.abc123", widths: [160, 320, 640], width: 1408, height: 768 };

describe("thumbnail URLs", () => {
  it("puts width and format after the base", () => {
    expect(thumbnailUrl(SET, 320, "avif")).toBe("/tool-images/thumbs/form-4.abc123.320.avif");
  });

  it("offers every width in a srcset, per format", () => {
    expect(thumbnailSrcSet(SET, "webp")).toBe(
      "/tool-images/thumbs/form-4.abc123.160.webp 160w, /tool-images/thumbs/form-4.abc123.320.webp 320w, /tool-images/thumbs/form-4.abc123.640.webp 640w"
    );
  });

  it("falls back to the WebP nearest 320px, never the largest", () => {
    expect(thumbnailFallbackSrc(SET)).toBe("/tool-images/thumbs/form-4.abc123.320.webp");
    expect(thumbnailFallbackSrc({ ...SET, widths: [160, 200] })).toBe("/tool-images/thumbs/form-4.abc123.200.webp");
  });
});

describe("plannedWidths", () => {
  it("renders every standard width a large source reaches", () => {
    expect(plannedWidths(2500)).toEqual([160, 320, 640]);
    expect(plannedWidths(640)).toEqual([160, 320, 640]);
  });

  it("adds a smaller source's own width and never enlarges", () => {
    expect(plannedWidths(500)).toEqual([160, 320, 500]);
    expect(plannedWidths(90)).toEqual([90]);
  });
});

describe("isImageThumbnails", () => {
  it("accepts the stored shape and rejects anything else", () => {
    expect(isImageThumbnails(SET)).toBe(true);
    expect(isImageThumbnails(null)).toBe(false);
    expect(isImageThumbnails({ ...SET, widths: [] })).toBe(false);
    expect(isImageThumbnails({ ...SET, base: "" })).toBe(false);
    expect(isImageThumbnails({ ...SET, width: 0 })).toBe(false);
    expect(isImageThumbnails({ base: "x", widths: ["320"], width: 1, height: 1 })).toBe(false);
  });
});

describe("thumbnailBlobPathnames", () => {
  it("names every file of a Vercel Blob set", () => {
    const set = { ...SET, widths: [160, 320], base: "https://abc.public.blob.vercel-storage.com/thumbs/uploads/tool/IMG_1-x9.0123456789ab" };
    expect(thumbnailBlobPathnames(set)).toEqual([
      "thumbs/uploads/tool/IMG_1-x9.0123456789ab.160.avif",
      "thumbs/uploads/tool/IMG_1-x9.0123456789ab.160.webp",
      "thumbs/uploads/tool/IMG_1-x9.0123456789ab.320.avif",
      "thumbs/uploads/tool/IMG_1-x9.0123456789ab.320.webp",
    ]);
  });

  it("reads the local store's /api/dev-blob URLs, decoding them", () => {
    const set = { ...SET, widths: [160], base: "http://localhost:3000/api/dev-blob/thumbs/uploads/a%20b.ff" };
    expect(thumbnailBlobPathnames(set)).toEqual(["thumbs/uploads/a b.ff.160.avif", "thumbs/uploads/a b.ff.160.webp"]);
  });

  it("names nothing for a bundled set or a malformed value", () => {
    expect(thumbnailBlobPathnames(SET)).toEqual([]);
    expect(thumbnailBlobPathnames({ ...SET, base: "https://elsewhere.example/photo" })).toEqual([]);
    expect(thumbnailBlobPathnames(undefined)).toEqual([]);
  });
});
