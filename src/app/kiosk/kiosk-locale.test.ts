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

  it("falls back to English for every string a locale has not translated yet (Article 6)", async () => {
    const messages = await kioskMessages("ja");
    // Japanese translates only the on-shift label so far (on-shift spec 2026-10-07).
    expect(messages.kiosk).toEqual({ ...en.kiosk, onShiftLabel: "現在シフト中" });
  });
});
