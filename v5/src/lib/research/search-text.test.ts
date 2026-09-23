// @vitest-environment node
import {
  MAX_SEARCH_TEXTS_CARRIED,
  SEARCH_TEXT_MIN_CHARS,
  findSearchText,
  pageKey,
  selectSearchTexts,
  usesSearchText,
} from "./search-text";

/**
 * The search's captured page text as the read step's fallback (amendment
 * "Search text fallback and confidence cap"): which page a URL is, which copy
 * stands in for it, which copies cross the step boundary, and which failed
 * reads it replaces.
 */

const LONG = "The Bambu Lab X2D is a dual-nozzle FDM printer. ".repeat(10);

function copy(url: string, text = LONG) {
  return { url, title: `Title of ${url}`, text };
}

describe("pageKey", () => {
  it("ignores www., case, a trailing slash, the query, the fragment and a leading locale", () => {
    const key = pageKey("https://bambulab.com/en/x2d");
    expect(key).toBe("bambulab.com/x2d");
    expect(pageKey("https://www.BambuLab.com/en-us/x2d/?utm=1#specs")).toBe(key);
    expect(pageKey("https://bambulab.com/pt_BR/x2d")).toBe(key);
  });

  it("keeps a lone segment and anything that is not a locale", () => {
    expect(pageKey("https://bambulab.com/en")).toBe("bambulab.com/en");
    expect(pageKey("https://bambulab.com/en/x2d/specs")).not.toBe(pageKey("https://bambulab.com/en/x2d"));
    expect(pageKey("https://prusa3d.com/product/mk4s")).toBe("prusa3d.com/product/mk4s");
  });

  it("is null for anything that is not an http(s) URL", () => {
    expect(pageKey("ftp://bambulab.com/x2d")).toBeNull();
    expect(pageKey("not a url")).toBeNull();
  });
});

describe("findSearchText", () => {
  it("prefers the copy for exactly that URL, then one for the same page at a variant URL", () => {
    const texts = [copy("https://bambulab.com/en-us/x2d"), copy("https://bambulab.com/en/x2d")];
    expect(findSearchText("https://bambulab.com/en/x2d", texts)?.url).toBe("https://bambulab.com/en/x2d");
    expect(findSearchText("https://bambulab.com/de/x2d/", texts)?.url).toBe("https://bambulab.com/en-us/x2d");
  });

  it("finds nothing for another page, and ignores a copy too short to be the page", () => {
    const texts = [copy("https://bambulab.com/en/x2d/specs", "Cookie settings"), copy("https://bambulab.com/en/h2d")];
    expect(findSearchText("https://bambulab.com/en/x2d/specs", texts)).toBeNull();
    expect(findSearchText("https://bambulab.com/en/x2d", texts)).toBeNull();
    expect("Cookie settings".length).toBeLessThan(SEARCH_TEXT_MIN_CHARS);
  });
});

describe("selectSearchTexts", () => {
  it("carries only the copies of pages the read step may try, in that order, each once", () => {
    const texts = [
      copy("https://www.youtube.com/watch?v=x2d"),
      copy("https://reviews.test/x2d"),
      copy("https://bambulab.com/en-us/x2d"),
      copy("https://bambulab.com/en/support/x2d"),
    ];
    const selected = selectSearchTexts(texts, [
      "https://bambulab.com/en/x2d",
      "https://bambulab.com/en/support/x2d",
      "https://bambulab.com/fr/x2d", // the same page again — already carried
      "https://nowhere.test/",
    ]);
    expect(selected.map((entry) => entry.url)).toEqual([
      "https://bambulab.com/en-us/x2d",
      "https://bambulab.com/en/support/x2d",
    ]);
  });

  it(`carries at most ${MAX_SEARCH_TEXTS_CARRIED}`, () => {
    const urls = Array.from({ length: 12 }, (_, n) => `https://site${n}.test/page`);
    expect(selectSearchTexts(urls.map((url) => copy(url)), urls)).toHaveLength(MAX_SEARCH_TEXTS_CARRIED);
  });
});

describe("usesSearchText", () => {
  const outcome = (status: "ok" | "blocked" | "failed" | "too_large" | "unsupported", text: string | null = null, pdf: Uint8Array | null = null) => ({
    status,
    text,
    pdf,
  });

  it("stands in for an HTTP error (a 403 bot challenge, a 429), a timeout, a page too large, and a page with no text", () => {
    expect(usesSearchText(outcome("failed"))).toBe(true);
    expect(usesSearchText(outcome("too_large"))).toBe(true);
    expect(usesSearchText(outcome("ok", "   "))).toBe(true);
  });

  it("never for a page read with text, a PDF, an unsupported type, or a page our own guard refused", () => {
    expect(usesSearchText(outcome("ok", "Specs"))).toBe(false);
    expect(usesSearchText(outcome("ok", null, new Uint8Array([37, 80, 68, 70])))).toBe(false);
    expect(usesSearchText(outcome("unsupported"))).toBe(false);
    expect(usesSearchText(outcome("blocked"))).toBe(false);
  });
});
