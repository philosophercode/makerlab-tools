// @vitest-environment node
import { keepEnglishLinks, linkLanguage } from "./english-links";
import { pageLanguage } from "./language";
import { ENGLISH, FRENCH, GERMAN, JAPANESE, repeat } from "./language-samples.test-helpers";
import type { PageLanguageRecord } from "./read-pages";

/**
 * The link gate (gateway spec amendment 2026-09-26 "English resources only"):
 * research keeps English pages and manuals only, judged from what it already
 * read. Nothing here fetches.
 */

const record = (url: string, text: string, opts: { requested?: string; lang?: string; manual?: boolean } = {}): PageLanguageRecord => ({
  url,
  requested: opts.requested ?? url,
  judgement: pageLanguage({ url, lang: opts.lang, text, manual: opts.manual }),
});

describe("keepEnglishLinks", () => {
  it("drops a German manufacturer page, with the reason the reviewer reads", () => {
    const url = "https://www.bambulab.com/de-de/x2d";
    const { kept, dropped } = keepEnglishLinks([{ title: "X2D Produktseite", url, type: "Other" }], {
      languages: [record(url, repeat(GERMAN, 3), { lang: "de" })],
    });
    expect(kept).toEqual([]);
    expect(dropped).toEqual([`Other "X2D Produktseite" (${url}) — not English (de, from the page's text)`]);
  });

  it("drops a German page even when it declares lang='en'", () => {
    const url = "https://maker.test/x2d";
    const { kept } = keepEnglishLinks([{ title: "X2D", url, type: "Other" }], {
      languages: [record(url, repeat(GERMAN, 3), { lang: "en" })],
    });
    expect(kept).toEqual([]);
  });

  it("keeps the en-us page", () => {
    const url = "https://www.bambulab.com/en-us/x2d";
    const link = { title: "X2D product page", url, type: "Other" };
    expect(keepEnglishLinks([link], { languages: [record(url, repeat(ENGLISH, 3), { lang: "en-US" })] })).toEqual({
      kept: [link],
      dropped: [],
    });
    // On its address alone, too.
    expect(keepEnglishLinks([link]).kept).toEqual([link]);
  });

  it("keeps a multilingual PDF manual with an English section", () => {
    const url = "https://cdn.maker.test/x2d-manual.pdf";
    const text = repeat(GERMAN, 12) + repeat(FRENCH, 12) + repeat(ENGLISH, 3) + repeat(JAPANESE, 12);
    const link = { title: "X2D manual (PDF)", url, type: "Manual" };
    expect(keepEnglishLinks([link], { languages: [record(url, text, { manual: true })] }).kept).toEqual([link]);
    // From the search's copy of it, too: a manual needs only one English section.
    expect(keepEnglishLinks([link], { searchTexts: [{ url, title: null, text }] }).kept).toEqual([link]);
  });

  it("drops a German-only PDF manual found by the search", () => {
    const url = "https://cdn.maker.test/x2d-anleitung.pdf";
    const { kept, dropped } = keepEnglishLinks([{ title: "X2D manual", url, type: "Manual" }], {
      searchTexts: [{ url, title: null, text: repeat(GERMAN, 6) }],
    });
    expect(kept).toEqual([]);
    expect(dropped[0]).toContain("not English (de, from the page's text)");
  });

  it("drops by the URL's locale when there is no text, and by the title last", () => {
    const { kept, dropped } = keepEnglishLinks([
      { title: "X2D", url: "https://www.maker.test/fr-fr/x2d", type: "Other" },
      { title: "X2D manual", url: "https://cdn.maker.test/X2D_DE.pdf", type: "Manual" },
      { title: "X2D Bedienungsanleitung", url: "https://cdn.maker.test/x2d.pdf", type: "Manual" },
      { title: "Unknown page", url: "https://maker.test/x2d", type: "Other" },
    ]);
    expect(kept.map((link) => link.url)).toEqual(["https://maker.test/x2d"]);
    expect(dropped).toEqual([
      'Other "X2D" (https://www.maker.test/fr-fr/x2d) — not English (fr, from its address)',
      'Manual "X2D manual" (https://cdn.maker.test/X2D_DE.pdf) — not English (de, from its address)',
      'Manual "X2D Bedienungsanleitung" (https://cdn.maker.test/x2d.pdf) — not English (de, from its title)',
    ]);
  });

  it("text beats the URL: an English page under /de/ is kept", () => {
    const url = "https://maker.test/de/x2d";
    const link = { title: "X2D", url, type: "Other" };
    expect(keepEnglishLinks([link], { languages: [record(url, repeat(ENGLISH, 3))] }).kept).toEqual([link]);
  });

  it("matches a read by the URL asked for as well as the one it ended at, ignoring a trailing slash", () => {
    const languages = [record("https://maker.test/de/x2d", repeat(GERMAN, 3), { requested: "https://maker.test/x2d" })];
    expect(linkLanguage({ title: "X2D", url: "https://maker.test/x2d/", type: "Other" }, { languages }).verdict).toBe("not_english");
  });

  it("does not take another locale's copy for this URL", () => {
    // The search captured only the German variant; the en-us link is judged on its own address.
    const link = { title: "X2D", url: "https://maker.test/en-us/x2d", type: "Other" };
    const searchTexts = [{ url: "https://maker.test/de-de/x2d", title: null, text: repeat(GERMAN, 3) }];
    expect(keepEnglishLinks([link], { searchTexts }).kept).toEqual([link]);
  });
});
