// @vitest-environment node
import { imageIdentity } from "./image-url";

/**
 * When two image URLs are one picture (amendment "Composites and product
 * crop"): size variants of a CDN or a Shopify store collapse, other query
 * parameters do not.
 */

describe("imageIdentity", () => {
  it("ignores scheme, www, fragment and a trailing slash", () => {
    expect(imageIdentity("http://www.shop.test/a.jpg#x")).toBe(imageIdentity("https://shop.test/a.jpg/"));
  });

  it.each([
    ["a width parameter", "https://shop.test/files/air.jpg?v=1&width=4472", "https://shop.test/files/air.jpg?v=1"],
    ["w and h", "https://cdn.test/p.jpg?w=640&h=480&fit=crop", "https://cdn.test/p.jpg"],
    ["Shopify _640x", "https://shop.test/files/air_640x.jpg?v=1", "https://shop.test/files/air.jpg?v=2"],
    ["Shopify _1024x1024", "https://shop.test/files/air_1024x1024.jpg", "https://shop.test/files/air.jpg"],
    ["Shopify _x800", "https://shop.test/files/air_x800.png", "https://shop.test/files/air.png"],
    ["Shopify _grande and _crop_center", "https://shop.test/files/air_grande_crop_center.jpg", "https://shop.test/files/air.jpg"],
    ["a density suffix", "https://shop.test/files/air_640x@2x.jpg", "https://shop.test/files/air@3x.jpg"],
  ])("treats %s as the same picture", (_label, a, b) => {
    expect(imageIdentity(a)).toBe(imageIdentity(b));
  });

  it("treats Alibaba OSS's processing parameter as a variant of the same picture (the X2D's page)", () => {
    const base = "https://portal.bblmw.com/x2d/product/1/x2d-sm.jpg";
    expect(imageIdentity(`${base}?x-oss-process=image%2Fformat%2Cwebp`)).toBe(imageIdentity(base));
  });

  it("keeps parameters that name a different picture, in any order", () => {
    expect(imageIdentity("https://cdn.test/img?id=1")).not.toBe(imageIdentity("https://cdn.test/img?id=2"));
    expect(imageIdentity("https://cdn.test/img?a=1&b=2")).toBe(imageIdentity("https://cdn.test/img?b=2&a=1&width=9"));
  });

  it("does not strip a name that merely ends in digits", () => {
    expect(imageIdentity("https://shop.test/files/model_3000.jpg")).not.toBe(imageIdentity("https://shop.test/files/model.jpg"));
  });
});
