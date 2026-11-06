// @vitest-environment node
import { imageIdentity, unwrapImageProxy } from "./image-url";

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

describe("unwrapImageProxy", () => {
  it("takes the original out of a Next.js image proxy", () => {
    expect(
      unwrapImageProxy("https://formlabs.com/_next/image/?url=https%3A%2F%2Fformlabs-media.formlabs.com%2Ffiler_public%2Fa%2Fform4.png&w=640&q=75")
    ).toBe("https://formlabs-media.formlabs.com/filer_public/a/form4.png");
    expect(unwrapImageProxy("https://example.com/_next/image?url=%2Fimages%2Fmill.jpg&w=384")).toBe("https://example.com/images/mill.jpg");
  });

  it("takes the original out of a JSON-encoded resize request", () => {
    const proxied =
      "https://www.troteclaser.com/static_processed/78bf/speedy400_front_30.png?{%22image%22:%22https://backend.troteclaser.com/static/images/Speedy400_front_30.png%22,%22edits%22:{%22resize%22:{%22width%22:615,%22height%22:350}}}";
    expect(unwrapImageProxy(proxied)).toBe("https://backend.troteclaser.com/static/images/Speedy400_front_30.png");
  });

  it("leaves everything else as it is", () => {
    for (const href of [
      "https://bambulab.com/h2d.jpg?width=1200",
      "https://example.com/_next/image?url=javascript%3Aalert(1)",
      "https://example.com/a.png?{not json",
      "https://example.com/a.png?%7B%22image%22%3A%22ftp%3A%2F%2Fx%22%7D",
      "not a url",
    ]) {
      expect(unwrapImageProxy(href)).toBe(href);
    }
  });
});
