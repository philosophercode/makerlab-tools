// @vitest-environment node
import { IMAGE_MAX_CANDIDATES } from "../../intake/limits";
import type { ImageHint } from "../../web/read-page";
import { collectCandidates, dedupeKey } from "./candidates";

/**
 * Candidate gathering (gateway spec §3.5 step 1, §10 "Candidate de-duplication
 * and filtering"): pages first, Exa only as a top-up, one URL once.
 */

const PAGE = "https://maker.example/p1s";

function page(url: string, source: ImageHint["source"] = "og", pageUrl: string | null = PAGE): ImageHint {
  return { url, source, pageUrl };
}

function exa(url: string, pageUrl: string | null = "https://reviews.example/p1s"): ImageHint {
  return { url, source: "exa", pageUrl };
}

const urls = (hints: ImageHint[]) => hints.map((hint) => hint.url);

describe("collectCandidates", () => {
  it("puts every page's og first, then twitter, then JSON-LD, each in page order", () => {
    const hints = [
      page("https://maker.example/a-jsonld.png", "jsonld"),
      page("https://maker.example/a-og.png", "og"),
      page("https://maker.example/a-twitter.png", "twitter"),
      page("https://other.example/b-og.png", "og", "https://other.example/p1s"),
    ];
    expect(urls(collectCandidates(hints, []))).toEqual([
      "https://maker.example/a-og.png",
      "https://other.example/b-og.png",
      "https://maker.example/a-twitter.png",
      "https://maker.example/a-jsonld.png",
    ]);
  });

  it("adds Exa's images only when the pages declared fewer than three", () => {
    const two = [page("https://maker.example/1.png"), page("https://maker.example/2.png", "jsonld")];
    const three = [...two, page("https://maker.example/3.png", "twitter")];
    const fromExa = [exa("https://cdn.example/x.jpg"), exa("https://cdn.example/y.jpg")];

    const topped = collectCandidates(two, fromExa);
    expect(urls(topped)).toEqual([
      "https://maker.example/1.png",
      "https://maker.example/2.png",
      "https://cdn.example/x.jpg",
      "https://cdn.example/y.jpg",
    ]);
    expect(topped.slice(2).every((hint) => hint.source === "exa")).toBe(true);

    expect(urls(collectCandidates(three, fromExa))).toHaveLength(3);
    expect(collectCandidates(three, fromExa).some((hint) => hint.source === "exa")).toBe(false);
  });

  it("uses Exa alone when the pages declared nothing", () => {
    expect(urls(collectCandidates([], [exa("https://cdn.example/x.jpg")]))).toEqual(["https://cdn.example/x.jpg"]);
  });

  it("counts de-duplicated page images toward the top-up threshold", () => {
    const same = [page("https://maker.example/1.png"), page("https://maker.example/1.png", "twitter"), page("http://maker.example/1.png", "jsonld")];
    const result = collectCandidates(same, [exa("https://cdn.example/x.jpg")]);
    expect(urls(result)).toEqual(["https://maker.example/1.png", "https://cdn.example/x.jpg"]);
  });

  it("treats a fragment, http/https and a trailing slash as one image, keeping the first spelling", () => {
    const hints = [
      page("http://maker.example/img/hero/#top"),
      page("https://maker.example/img/hero", "twitter"),
      page("https://MAKER.example/img/hero/", "jsonld"),
    ];
    expect(collectCandidates(hints, [])).toEqual([{ url: "http://maker.example/img/hero/", source: "og", pageUrl: PAGE }]);
    // A different query string is a different image — unless it only picks a size.
    expect(collectCandidates([page("https://maker.example/i.png?id=1"), page("https://maker.example/i.png?id=2")], [])).toHaveLength(2);
    expect(collectCandidates([page("https://maker.example/i.png?w=1"), page("https://maker.example/i.png?w=2")], [])).toHaveLength(1);
  });

  it("keeps http(s) only and drops what is not a URL", () => {
    const hints = [
      page("data:image/png;base64,AAAA"),
      page("javascript:alert(1)"),
      page("ftp://maker.example/a.png"),
      page("not a url"),
      page(`https://maker.example/${"a".repeat(3000)}.png`),
      page("https://maker.example/ok.png"),
    ];
    expect(urls(collectCandidates(hints, []))).toEqual(["https://maker.example/ok.png"]);
  });

  it("drops a page URL that is not http(s) but keeps the image", () => {
    expect(collectCandidates([page("https://maker.example/ok.png", "og", "file:///etc/passwd")], [])).toEqual([
      { url: "https://maker.example/ok.png", source: "og", pageUrl: null },
    ]);
  });

  it(`stops at ${IMAGE_MAX_CANDIDATES}`, () => {
    const many = Array.from({ length: 12 }, (_, i) => page(`https://maker.example/${i}.png`));
    const result = collectCandidates(many.slice(0, 2), many.slice(2).map((hint) => exa(hint.url)));
    expect(result).toHaveLength(IMAGE_MAX_CANDIDATES);
    expect(collectCandidates(many, [])).toHaveLength(IMAGE_MAX_CANDIDATES);
  });

  it("interleaves JSON-LD and gallery pictures after the metadata, so banners in JSON-LD cannot crowd out the gallery", () => {
    const banners = Array.from({ length: 6 }, (_, i) => page(`https://shop.example/files/banner-${i}.jpg`, "jsonld"));
    const shots = Array.from({ length: 3 }, (_, i) => page(`https://shop.example/files/air-${i}.jpg`, "gallery"));
    const result = urls(collectCandidates([...banners, ...shots, page("https://shop.example/files/og.jpg", "og")], []));
    expect(result.slice(0, 7)).toEqual([
      "https://shop.example/files/og.jpg",
      "https://shop.example/files/banner-0.jpg",
      "https://shop.example/files/air-0.jpg",
      "https://shop.example/files/banner-1.jpg",
      "https://shop.example/files/air-1.jpg",
      "https://shop.example/files/banner-2.jpg",
      "https://shop.example/files/air-2.jpg",
    ]);
    expect(result).toHaveLength(IMAGE_MAX_CANDIDATES);
  });

  it("counts a Shopify size variant of a picture already listed as that picture", () => {
    const hints = [
      page("http://www.shop.example/cdn/shop/files/air-1.jpg?v=175"),
      page("https://www.shop.example/cdn/shop/files/air-1.jpg?v=175&width=4472", "gallery"),
      page("https://www.shop.example/cdn/shop/files/air-2_640x.jpg?v=175", "gallery"),
      page("https://www.shop.example/cdn/shop/files/air-2_2048x2048.jpg?v=175", "jsonld"),
      page("https://www.shop.example/cdn/shop/files/air-3.jpg?v=175", "gallery"),
    ];
    expect(urls(collectCandidates(hints, []))).toEqual([
      "http://www.shop.example/cdn/shop/files/air-1.jpg?v=175",
      "https://www.shop.example/cdn/shop/files/air-2_2048x2048.jpg?v=175",
      "https://www.shop.example/cdn/shop/files/air-3.jpg?v=175",
    ]);
  });

  it("ignores an Exa hint that slipped into the page list", () => {
    expect(collectCandidates([exa("https://cdn.example/x.jpg")], [])).toEqual([]);
  });
});

describe("dedupeKey", () => {
  it("ignores scheme and trailing slashes but not the query", () => {
    expect(dedupeKey("http://a.example/x/")).toBe(dedupeKey("https://a.example/x"));
    expect(dedupeKey("https://a.example/x?q=1")).not.toBe(dedupeKey("https://a.example/x?q=2"));
  });
});

describe('collectCandidates — source weighting (amendment "Product-page first, front-facing images")', () => {
  const X2D = { brand: "Bambu Lab", name: "Bambu Lab X2D" };
  const WIKI = "https://wiki.bambulab.com/en/x2d/manual/first-print";
  const PRODUCT = "https://bambulab.com/en/x2d";

  it("takes the product page's pictures before the wiki's, whichever was read first", () => {
    const hints = [
      page("https://wiki.bambulab.com/back.jpg", "og", WIKI),
      page("https://wiki.bambulab.com/side.jpg", "gallery", WIKI),
      page("https://bambulab.com/x2d-gallery.jpg", "gallery", PRODUCT),
      page("https://bambulab.com/x2d-og.jpg", "og", PRODUCT),
    ];
    expect(urls(collectCandidates(hints, [], X2D))).toEqual([
      "https://bambulab.com/x2d-og.jpg",
      "https://bambulab.com/x2d-gallery.jpg",
      "https://wiki.bambulab.com/back.jpg",
      "https://wiki.bambulab.com/side.jpg",
    ]);
  });

  it("keeps the old order without a subject", () => {
    const hints = [page("https://wiki.bambulab.com/back.jpg", "og", WIKI), page("https://bambulab.com/x2d-og.jpg", "og", PRODUCT)];
    expect(urls(collectCandidates(hints, []))).toEqual(["https://wiki.bambulab.com/back.jpg", "https://bambulab.com/x2d-og.jpg"]);
  });
});

