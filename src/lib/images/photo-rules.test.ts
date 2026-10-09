import {
  PHOTO_ACCEPT,
  PHOTO_UPLOAD_MAX_EDGE,
  VISION_MAX_EDGE,
  fitWithin,
  heifTypeForName,
  isPhotoFile,
  photoUploadName,
  uploadFormatFor,
} from "./photo-rules";

/**
 * The size and format rules a photo is held to, in the browser and on the
 * server alike (data platform spec amendment 2026-10-08).
 */

describe("fitWithin", () => {
  it("never enlarges a small image", () => {
    expect(fitWithin(800, 600, PHOTO_UPLOAD_MAX_EDGE)).toEqual({ width: 800, height: 600 });
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a 12 MP phone photo to the stored size and to the model's size", () => {
    expect(fitWithin(4032, 3024, PHOTO_UPLOAD_MAX_EDGE)).toEqual({ width: 2048, height: 1536 });
    expect(fitWithin(4032, 3024)).toEqual({ width: VISION_MAX_EDGE, height: 1176 });
  });

  it("scales a portrait photo by its height", () => {
    expect(fitWithin(3024, 4032, PHOTO_UPLOAD_MAX_EDGE)).toEqual({ width: 1536, height: 2048 });
    expect(fitWithin(3024, 4032)).toEqual({ width: 1176, height: VISION_MAX_EDGE });
  });

  it("leaves an image exactly at the edge, and degenerate sizes, as they are", () => {
    expect(fitWithin(2048, 1000, PHOTO_UPLOAD_MAX_EDGE)).toEqual({ width: 2048, height: 1000 });
    expect(fitWithin(0, 0)).toEqual({ width: 0, height: 0 });
  });

  it("never rounds a sliver down to nothing", () => {
    expect(fitWithin(10_000, 1, PHOTO_UPLOAD_MAX_EDGE)).toEqual({ width: 2048, height: 1 });
  });
});

describe("uploadFormatFor", () => {
  it("keeps a PNG with transparency a PNG", () => {
    expect(uploadFormatFor({ sourceType: "image/png", hasAlpha: true })).toBe("image/png");
    expect(uploadFormatFor({ sourceType: "image/webp", hasAlpha: true })).toBe("image/png");
  });

  it("makes an opaque PNG — a screenshot — a JPEG", () => {
    expect(uploadFormatFor({ sourceType: "image/png", hasAlpha: false })).toBe("image/jpeg");
  });

  it("makes every photo a JPEG, HEIC included", () => {
    for (const sourceType of ["image/jpeg", "image/heic", "image/heif", "image/avif", ""]) {
      expect(uploadFormatFor({ sourceType, hasAlpha: false })).toBe("image/jpeg");
    }
  });

  it("does not trust an alpha claim for a format that has none", () => {
    expect(uploadFormatFor({ sourceType: "image/jpeg", hasAlpha: true })).toBe("image/jpeg");
  });
});

describe("photoUploadName", () => {
  it("keeps the stem and names what the file now is", () => {
    expect(photoUploadName("IMG_0412.HEIC", "image/jpeg")).toBe("IMG_0412.jpg");
    expect(photoUploadName("cutout.png", "image/png")).toBe("cutout.png");
    expect(photoUploadName("scan.webp", "image/jpeg")).toBe("scan.jpg");
  });

  it("names a nameless photo", () => {
    expect(photoUploadName("", "image/jpeg")).toBe("photo.jpg");
    expect(photoUploadName(undefined, "image/png")).toBe("photo.png");
  });
});

describe("HEIC by name", () => {
  it("knows .heic and .heif in any case", () => {
    expect(heifTypeForName("IMG_0412.HEIC")).toBe("image/heic");
    expect(heifTypeForName("photo.heif")).toBe("image/heif");
    expect(heifTypeForName("photo.jpg")).toBeNull();
    expect(heifTypeForName("heic")).toBeNull();
  });

  it("treats an untyped .heic as a photo, and an untyped anything else as not", () => {
    expect(isPhotoFile({ type: "", name: "IMG_0412.HEIC" })).toBe(true);
    expect(isPhotoFile({ type: "application/octet-stream", name: "IMG_0412.heic" })).toBe(true);
    expect(isPhotoFile({ type: "image/jpeg", name: "a.jpg" })).toBe(true);
    expect(isPhotoFile({ type: "", name: "list.csv" })).toBe(false);
    expect(isPhotoFile({ type: "text/plain", name: "notes.heic" })).toBe(false);
  });
});

describe("PHOTO_ACCEPT", () => {
  it("offers JPEG, PNG, WebP and HEIC/HEIF by type and by extension", () => {
    expect([...PHOTO_ACCEPT]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/heic",
      "image/heif",
      ".heic",
      ".heif",
    ]);
  });
});
