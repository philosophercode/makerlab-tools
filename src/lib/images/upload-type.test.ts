import { uploadImageType } from "./upload-type";

const bytes = (...values: number[]) => new Uint8Array(values);
const text = (value: string) => new TextEncoder().encode(value);

describe("uploadImageType — what an upload is, from its bytes", () => {
  it("recognises a PNG, a JPEG and a GIF", () => {
    expect(
      uploadImageType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 2, 0, 0, 0, 3, 8, 2, 0, 0, 0, 0, 0, 0, 0)
      )
    ).toBe("image/png");
    expect(uploadImageType(bytes(0xff, 0xd8, 0xff, 0xc0, 0, 17, 8, 0, 4, 0, 6, 3))).toBe("image/jpeg");
    expect(uploadImageType(bytes(...text("GIF89a"), 1, 0, 1, 0))).toBe("image/gif");
  });

  it("refuses SVG, HTML, a GIF signature with no size, and empty input", () => {
    expect(uploadImageType(text('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(uploadImageType(text("<!doctype html><script>alert(1)</script>"))).toBeNull();
    expect(uploadImageType(bytes(...text("GIF89a"), 0, 0, 0, 0))).toBeNull();
    expect(uploadImageType(new Uint8Array(0))).toBeNull();
  });
});
