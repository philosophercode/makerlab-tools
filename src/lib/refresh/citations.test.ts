import { normalizeForQuote, pageKey, quoteAppearsIn, verifyCitations, verifyQuotes } from "./citations";

/** Quote verification (refresh research spec §4.2, §10). */

const PAGE = {
  url: "https://wenproducts.com/products/dc3401",
  text: "WEN DC3401 3-Speed Air Filtration System\n\nFilters   particles down to\n5 microns — with a 1-micron inner filter.",
};

describe("verifyQuotes", () => {
  it("verifies an exact quote on the page it names", () => {
    const [citation] = verifyQuotes([{ quote: "WEN DC3401 3-Speed Air Filtration System", url: PAGE.url }], [PAGE]);
    expect(citation).toEqual({ quote: "WEN DC3401 3-Speed Air Filtration System", url: PAGE.url, verified: true });
  });

  it("forgives whitespace, case, typographic dashes and a trailing full stop", () => {
    const [citation] = verifyQuotes([{ quote: "filters particles down to 5 microns - with a 1-micron inner filter.", url: PAGE.url }], [PAGE]);
    expect(citation.verified).toBe(true);
  });

  it("does not verify a quote that is not on the page", () => {
    const [citation] = verifyQuotes([{ quote: "Filters particles down to 1 micron", url: PAGE.url }], [PAGE]);
    expect(citation.verified).toBe(false);
  });

  it("does not verify a real quote attributed to a page that was not read", () => {
    const [citation] = verifyQuotes(
      [{ quote: "WEN DC3401 3-Speed Air Filtration System", url: "https://elsewhere.example/dc3401" }],
      [PAGE]
    );
    expect(citation.verified).toBe(false);
  });

  it("matches the page however its URL is spelled, fence label included", () => {
    const [a, b] = verifyQuotes(
      [
        { quote: "Filters particles down to 5 microns", url: "https://www.wenproducts.com/products/dc3401/#specs" },
        { quote: "Filters particles down to 5 microns", url: `${PAGE.url} (manual text)` },
      ],
      [PAGE]
    );
    expect(a.verified).toBe(true);
    expect(b.verified).toBe(true);
  });

  it("refuses a quote too short to prove anything", () => {
    expect(quoteAppearsIn("5", PAGE.text)).toBe(false);
  });

  it("keeps at most three quotes per field", () => {
    const quotes = Array.from({ length: 5 }, () => ({ quote: "Filters particles down to", url: PAGE.url }));
    expect(verifyQuotes(quotes, [PAGE])).toHaveLength(3);
  });
});

describe("verifyCitations", () => {
  it("checks every field and leaves out fields with no quotes", () => {
    const out = verifyCitations(
      { name: [{ quote: "WEN DC3401 3-Speed", url: PAGE.url }], use_restrictions: [], tags: [{ quote: "invented tag text", url: PAGE.url }] },
      [PAGE]
    );
    expect(Object.keys(out).sort()).toEqual(["name", "tags"]);
    expect(out.name?.[0].verified).toBe(true);
    expect(out.tags?.[0].verified).toBe(false);
  });
});

describe("helpers", () => {
  it("normalizeForQuote flattens typography", () => {
    expect(normalizeForQuote("“Hello”  —  world…")).toBe('"hello" - world...');
  });

  it("pageKey ignores scheme, www, trailing slash and fragment; null for a non-URL", () => {
    expect(pageKey("http://www.a.com/b/#x")).toBe(pageKey("https://a.com/b"));
    expect(pageKey("ftp://a.com")).toBeNull();
  });
});
