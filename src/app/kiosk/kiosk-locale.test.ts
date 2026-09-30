// @vitest-environment node
import en from "../../../messages/en.json";
import { kioskLocale, kioskMessages } from "./kiosk-locale";

/** The kiosk's language: the default unless `?lang=` names a supported locale (kiosk spec §6). */

describe("kioskLocale", () => {
  it.each([
    [undefined, "en", "ltr"],
    ["fr", "fr", "ltr"],
    ["he", "he", "rtl"],
    ["klingon", "en", "ltr"],
    [["fr", "es"], "en", "ltr"],
  ])("?lang=%j → %s", (lang, code, dir) => {
    const locale = kioskLocale(lang as string | string[] | undefined);
    expect(locale.code).toBe(code);
    expect(locale.dir).toBe(dir);
  });
});

describe("kioskMessages", () => {
  it("hands the screen only its own namespace", async () => {
    expect(Object.keys(await kioskMessages("en"))).toEqual(["kiosk"]);
  });

  it("falls back to English for a locale that has not translated it yet (Article 6)", async () => {
    const messages = await kioskMessages("ja");
    expect(messages.kiosk).toEqual(en.kiosk);
  });
});
