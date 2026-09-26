// @vitest-environment node
import {
  declaredLanguage,
  describeJudgement,
  pageLanguage,
  textLanguage,
  titleLanguage,
  urlLanguage,
  urlLanguages,
} from "./language";
import { ENGLISH, FRENCH, GERMAN, JAPANESE, repeat } from "./language-samples.test-helpers";

/**
 * Deterministic language judgement (gateway spec amendment 2026-09-26
 * "English resources only"). No model, no network.
 */

describe("urlLanguages — the URL's own locale", () => {
  it.each([
    ["https://www.bosch-diy.com/de/de/produkte/x", "de", "path"],
    ["https://www.example.com/de-de/products/x2d", "de", "path"],
    ["https://www.example.com/fr_FR/products/x2d", "fr", "path"],
    ["https://www.example.com/intl/ja/products/x2d", "ja", "path"],
    ["https://www.example.com/zh-hans/x2d", "zh", "path"],
    ["https://www.example.com/en-us/products/x2d", "en", "path"],
    ["https://www.example.com/en-gb/products/x2d", "en", "path"],
    ["https://de.example.com/products/x2d", "de", "subdomain"],
    ["https://en.wikipedia.org/wiki/3D_printing", "en", "subdomain"],
    ["https://www.example.com/products/x2d?lang=fr", "fr", "query"],
    ["https://www.example.com/products/x2d?hl=en-US", "en", "query"],
    ["https://cdn.example.com/docs/X2D_Quick_Start_Guide_EN.pdf", "en", "file"],
    ["https://cdn.example.com/docs/BA_X2D_DE.pdf", "de", "file"],
  ])("%s → %s (%s)", (url, lang, where) => {
    const found = urlLanguages(url);
    expect(found?.langs[0]).toBe(lang);
    expect(found?.where).toBe(where);
  });

  it("a multilingual file name that includes English is English", () => {
    expect(urlLanguages("https://cdn.example.com/manual_en_de_fr_it.pdf")?.langs).toEqual(["en", "de", "fr", "it"]);
    expect(urlLanguage("https://cdn.example.com/manual_en_de_fr_it.pdf").verdict).toBe("english");
    expect(urlLanguage("https://cdn.example.com/manual_de_fr.pdf")).toMatchObject({ verdict: "not_english", lang: "de" });
  });

  it("says nothing when the URL names no language", () => {
    expect(urlLanguages("https://bambulab.com/x2d")).toBeNull();
    expect(urlLanguages("https://www.prusa3d.com/product/original-prusa-mk4s/")).toBeNull();
    // A country top-level domain is not a language: German brands serve English under .de/en/.
    expect(urlLanguages("https://www.festool.de/products")).toBeNull();
    expect(urlLanguages("not a url")).toBeNull();
  });

  it("ambiguous tokens are not read alone", () => {
    expect(urlLanguages("https://www.example.com/uk/products/x")).toBeNull(); // United Kingdom, not Ukrainian
    expect(urlLanguages("https://www.example.com/ca/products/x")).toBeNull(); // Canada, not Catalan
    expect(urlLanguages("https://id.example.com/login")).toBeNull();
    expect(urlLanguages("https://cdn.example.com/it-guide.pdf")).toBeNull(); // "it", the word
    // With a region they are a locale.
    expect(urlLanguages("https://www.example.com/uk-ua/products/x")?.langs).toEqual(["uk"]);
    expect(urlLanguages("https://www.example.com/it/prodotti/x")?.langs).toEqual(["it"]);
  });

  it("a country segment before an English one is English (/de/en/)", () => {
    expect(urlLanguage("https://www.bosch-professional.com/de/en/products/gsr-18v-55").verdict).toBe("english");
    expect(urlLanguage("https://www.hilti.de/de/en/tools").verdict).toBe("english");
    expect(urlLanguages("https://www.bosch-diy.com/de/de/produkte/x")?.langs).toEqual(["de"]);
  });

  it("a university's or government's department subdomain is not a locale", () => {
    expect(urlLanguages("https://cs.cornell.edu/labs/x")).toBeNull();
    expect(urlLanguages("https://it.cornell.edu/3d-printing")).toBeNull();
    expect(urlLanguages("https://hr.ox.ac.uk/policies")).toBeNull();
    expect(urlLanguages("https://de.example.com/x")?.langs).toEqual(["de"]);
  });

  it("English words in a PDF's name are not languages (Wi-Fi, Pt-2)", () => {
    expect(urlLanguages("https://cdn.example.com/Router_Wi-Fi_Setup.pdf")).toBeNull();
    expect(urlLanguages("https://cdn.example.com/X1C-Pt-2-Assembly.pdf")).toBeNull();
    expect(urlLanguage("https://cdn.example.com/Wi-Fi_Setup_DE.pdf")).toMatchObject({ verdict: "not_english", lang: "de" });
  });
});

describe("declaredLanguage — <html lang>", () => {
  it("reads the primary subtag", () => {
    expect(declaredLanguage("en-US")).toMatchObject({ verdict: "english", lang: "en" });
    expect(declaredLanguage("de")).toMatchObject({ verdict: "not_english", lang: "de" });
    expect(declaredLanguage("nb-NO")).toMatchObject({ verdict: "not_english", lang: "no" });
    expect(declaredLanguage("")).toMatchObject({ verdict: "unknown" });
    expect(declaredLanguage(null)).toMatchObject({ verdict: "unknown" });
  });
});

describe("textLanguage — script and stop words", () => {
  it("English text is English", () => {
    expect(textLanguage(repeat(ENGLISH, 3))).toMatchObject({ verdict: "english", basis: "text" });
  });

  it("German, French and Japanese text are not", () => {
    expect(textLanguage(repeat(GERMAN, 3))).toMatchObject({ verdict: "not_english", lang: "de" });
    expect(textLanguage(repeat(FRENCH, 3))).toMatchObject({ verdict: "not_english", lang: "fr" });
    expect(textLanguage(repeat(JAPANESE, 4))).toMatchObject({ verdict: "not_english", lang: "ja" });
  });

  it("an English page with a German paragraph is English", () => {
    expect(textLanguage(repeat(ENGLISH, 8) + GERMAN).verdict).toBe("english");
  });

  it("a German page with one English paragraph is not", () => {
    expect(textLanguage(repeat(GERMAN, 20) + ENGLISH)).toMatchObject({ verdict: "not_english", lang: "de" });
  });

  it("a multilingual manual with an English section is English; without one it is not", () => {
    const multilingual = repeat(GERMAN, 12) + repeat(FRENCH, 12) + repeat(ENGLISH, 3) + repeat(JAPANESE, 12);
    expect(textLanguage(multilingual, { manual: true }).verdict).toBe("english");
    expect(textLanguage(repeat(GERMAN, 12) + repeat(FRENCH, 12), { manual: true }).verdict).toBe("not_english");
  });

  it("too little text is unknown", () => {
    expect(textLanguage("X2D — 350 × 320 × 325 mm").verdict).toBe("unknown");
    expect(textLanguage("")).toMatchObject({ verdict: "unknown", basis: "none" });
  });
});

describe("titleLanguage", () => {
  it("a foreign word for 'manual', or a non-Latin title, is not English", () => {
    expect(titleLanguage("X2D Bedienungsanleitung (PDF)")).toMatchObject({ verdict: "not_english", lang: "de" });
    expect(titleLanguage("Mode d'emploi X2D")).toMatchObject({ verdict: "not_english", lang: "fr" });
    expect(titleLanguage("X2D ユーザーマニュアル")).toMatchObject({ verdict: "not_english", lang: "ja" });
    expect(titleLanguage("Bambu Lab X2D 開箱與設定")).toMatchObject({ verdict: "not_english", lang: "zh" });
  });

  it("an ordinary English title says nothing", () => {
    expect(titleLanguage("X2D user manual (PDF)").verdict).toBe("unknown");
    expect(titleLanguage("Bambu Lab X2D product page").verdict).toBe("unknown");
  });

  it("Greek letters used as units in an English title say nothing", () => {
    expect(titleLanguage("Measuring 10 μF, 22 μF and 47 μF capacitors").verdict).toBe("unknown");
    expect(titleLanguage("Choosing 1kΩ, 10kΩ and 100kΩ resistors").verdict).toBe("unknown");
    expect(titleLanguage("Οδηγός χρήσης εκτυπωτή").verdict).toBe("not_english");
  });
});

describe("pageLanguage — strongest signal first", () => {
  it("text beats a template's lang='en' on a German page", () => {
    expect(pageLanguage({ url: "https://example.com/x2d", lang: "en", text: repeat(GERMAN, 3) })).toMatchObject({
      verdict: "not_english",
      basis: "text",
    });
  });

  it("English text under a /de/ path is kept", () => {
    expect(pageLanguage({ url: "https://example.com/de/x2d", text: repeat(ENGLISH, 3) }).verdict).toBe("english");
  });

  it("with too little text, the declared language, then the URL", () => {
    expect(pageLanguage({ url: "https://example.com/x2d", lang: "de", text: "X2D" })).toMatchObject({ verdict: "not_english", basis: "declared" });
    expect(pageLanguage({ url: "https://example.com/fr-fr/x2d", text: "X2D" })).toMatchObject({ verdict: "not_english", basis: "url" });
    expect(pageLanguage({ url: "https://example.com/x2d", text: "X2D" }).verdict).toBe("unknown");
  });

  it("an English address outweighs a German template's lang='de' when the text is not decisive", () => {
    expect(pageLanguage({ url: "https://www.festool.de/en-us/x", lang: "de", text: "KS 120 REB 1600 W 60 mm" })).toMatchObject({
      verdict: "english",
      basis: "url",
    });
    // …but German text under /en/ is still German.
    expect(pageLanguage({ url: "https://www.festool.de/en-us/x", lang: "de", text: repeat(GERMAN, 3) }).verdict).toBe("not_english");
  });

  it("describes a verdict in a few words", () => {
    expect(describeJudgement({ verdict: "not_english", lang: "de", basis: "text" })).toBe("de, from the page's text");
    expect(describeJudgement({ verdict: "not_english", lang: "fr", basis: "url" })).toBe("fr, from its address");
  });
});
