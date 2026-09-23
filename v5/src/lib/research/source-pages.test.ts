import { classifyPage, imagePageTier, isBrandHost, isVideoUrl, orderPagesForReading } from "./source-pages";

/**
 * Which pages research reads first, and whose pictures lead (amendment
 * "Product-page first, front-facing images, reviewer notes"). The fixtures are
 * the Bambu Lab X2D run that read the wiki and a video instead of the product
 * page.
 */

const X2D = { brand: "Bambu Lab", name: "Bambu Lab X2D" };
const PRODUCT = "https://bambulab.com/en/x2d";
const STORE = "https://store.bambulab.com/products/x2d";
const WIKI = "https://wiki.bambulab.com/en/x2d/manual/first-print";
const SUPPORT = "https://bambulab.com/en/support/x2d-faq";
const VIDEO = "https://www.youtube.com/watch?v=abc123";
const RETAILER = "https://www.microcenter.com/product/123/bambu-lab-x2d";

describe("classifyPage", () => {
  it("knows the brand's product pages from its manual, wiki and support pages", () => {
    expect(classifyPage(PRODUCT, X2D)).toBe("product");
    expect(classifyPage(STORE, X2D)).toBe("product");
    expect(classifyPage("https://bambulab.com/en/x2d/specs", X2D)).toBe("product");
    expect(classifyPage(WIKI, X2D)).toBe("manual");
    expect(classifyPage(SUPPORT, X2D)).toBe("manual");
    expect(classifyPage("https://bambulab.com/downloads/x2d-manual.pdf", X2D)).toBe("manual");
    expect(classifyPage("https://bambulab.com/en", X2D)).toBe("brand");
    expect(classifyPage(VIDEO, X2D)).toBe("video");
    expect(classifyPage(RETAILER, X2D)).toBe("other");
  });

  it("matches a brand to its domain by a distinctive word, not a generic one", () => {
    expect(isBrandHost("www.prusa3d.com", "Prusa Research")).toBe(true);
    expect(isBrandHost("researchgate.net", "Prusa Research")).toBe(false);
    expect(isBrandHost("formlabs.com", "Formlabs")).toBe(true);
    expect(isBrandHost("amazon.com", "Bambu Lab")).toBe(false);
    expect(isBrandHost("bambulab.com", null)).toBe(false);
  });

  it("recognises videos", () => {
    expect(isVideoUrl(VIDEO)).toBe(true);
    expect(isVideoUrl("https://youtu.be/abc")).toBe(true);
    expect(isVideoUrl("https://vimeo.com/123")).toBe(true);
    expect(isVideoUrl(PRODUCT)).toBe(false);
  });
});

describe("orderPagesForReading", () => {
  it("reads the product page first even when the model listed it last — the X2D run", () => {
    const order = orderPagesForReading([WIKI, VIDEO, SUPPORT, RETAILER, PRODUCT], X2D, 4);
    expect(order[0]).toBe(PRODUCT);
    expect(order).toEqual([PRODUCT, WIKI, SUPPORT, RETAILER]);
    expect(order).not.toContain(VIDEO);
  });

  it("keeps the model's order when there is no product page, videos last", () => {
    expect(orderPagesForReading([VIDEO, WIKI, RETAILER], X2D, 4)).toEqual([WIKI, RETAILER, VIDEO]);
    expect(orderPagesForReading([WIKI, PRODUCT], { brand: null, name: "X2D" }, 4)).toEqual([WIKI, PRODUCT]);
  });
});

describe("imagePageTier", () => {
  it("weighs the product page's pictures first and the wiki's last", () => {
    expect(imagePageTier(PRODUCT, X2D)).toBe(0);
    expect(imagePageTier(RETAILER, X2D)).toBe(1);
    expect(imagePageTier(null, X2D)).toBe(1);
    expect(imagePageTier(WIKI, X2D)).toBe(2);
  });
});
