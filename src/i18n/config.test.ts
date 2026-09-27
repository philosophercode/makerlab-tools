import {
  LOCALES,
  LOCALE_CODES,
  DEFAULT_LOCALE,
  isSupportedLocale,
  getLocaleOption,
  getDirection,
  languageNameForLocale,
} from "@/i18n/config";

describe("i18n/config", () => {
  describe("LOCALES / LOCALE_CODES", () => {
    it("has 12 locales", () => {
      expect(LOCALES).toHaveLength(12);
      expect(LOCALE_CODES).toHaveLength(12);
    });

    it("includes the expected codes", () => {
      expect(LOCALE_CODES).toEqual([
        "en",
        "zh-CN",
        "es",
        "hi",
        "ko",
        "ar",
        "fr",
        "pt-BR",
        "ru",
        "tr",
        "ja",
        "he",
      ]);
    });

    it("defaults to en", () => {
      expect(DEFAULT_LOCALE).toBe("en");
      expect(LOCALES[0].code).toBe("en");
    });
  });

  describe("isSupportedLocale", () => {
    it("is true for supported codes", () => {
      expect(isSupportedLocale("en")).toBe(true);
      expect(isSupportedLocale("ar")).toBe(true);
      expect(isSupportedLocale("zh-CN")).toBe(true);
    });

    it("is false for unsupported / empty / nullish values", () => {
      expect(isSupportedLocale(undefined)).toBe(false);
      expect(isSupportedLocale(null)).toBe(false);
      expect(isSupportedLocale("")).toBe(false);
      expect(isSupportedLocale("xx")).toBe(false);
    });
  });

  describe("getLocaleOption", () => {
    it("returns the matching option", () => {
      const ar = getLocaleOption("ar");
      expect(ar.code).toBe("ar");
      expect(ar.englishName).toBe("Arabic");
      expect(ar.dir).toBe("rtl");
    });

    it("falls back to LOCALES[0] (en) for an unknown code", () => {
      expect(getLocaleOption("xx")).toBe(LOCALES[0]);
      expect(getLocaleOption("xx").code).toBe("en");
    });
  });

  describe("getDirection", () => {
    it("returns rtl for ar and he", () => {
      expect(getDirection("ar")).toBe("rtl");
      expect(getDirection("he")).toBe("rtl");
    });

    it("returns ltr for ltr languages", () => {
      expect(getDirection("en")).toBe("ltr");
      expect(getDirection("es")).toBe("ltr");
      expect(getDirection("zh-CN")).toBe("ltr");
    });

    it("returns ltr (en fallback) for an unknown code", () => {
      expect(getDirection("xx")).toBe("ltr");
    });
  });

  describe("languageNameForLocale", () => {
    it("maps known codes to their English names", () => {
      expect(languageNameForLocale("ar")).toBe("Arabic");
      expect(languageNameForLocale("zh-CN")).toBe("Simplified Chinese");
    });

    it("falls back to English for an unknown code", () => {
      expect(languageNameForLocale("xx")).toBe("English");
    });
  });
});
