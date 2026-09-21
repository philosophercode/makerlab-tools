import en from "../../messages/en.json";
import { LOCALE_CODES } from "./config";
import { withEnglishFallback, type Messages } from "./messages";

describe("withEnglishFallback", () => {
  it("fills a key the locale lacks with the English one, nested namespaces included", () => {
    const english: Messages = { nav: { signIn: "SIGN IN", signInUnconfigured: "Not set up." } };
    const french: Messages = { nav: { signIn: "CONNEXION" } };

    expect(withEnglishFallback(english, french)).toEqual({
      nav: { signIn: "CONNEXION", signInUnconfigured: "Not set up." },
    });
  });

  it("keeps a whole namespace the locale defines and English does not", () => {
    const english: Messages = { nav: { signIn: "SIGN IN" } };
    const locale: Messages = { nav: { signIn: "X" }, extra: { only: "here" } };

    expect(withEnglishFallback(english, locale).extra).toEqual({ only: "here" });
  });

  it("does not mutate either input", () => {
    const english: Messages = { nav: { signIn: "SIGN IN" } };
    const locale: Messages = { nav: {} };
    withEnglishFallback(english, locale);
    expect(english).toEqual({ nav: { signIn: "SIGN IN" } });
    expect(locale).toEqual({ nav: {} });
  });

  it("gives every locale file every English key", async () => {
    for (const code of LOCALE_CODES) {
      const locale = (await import(`../../messages/${code}.json`)).default as Messages;
      const merged = withEnglishFallback(en as Messages, locale);
      expect(flatKeys(merged)).toEqual(expect.arrayContaining(flatKeys(en as Messages)));
    }
  });
});

function flatKeys(messages: Messages, prefix = ""): string[] {
  return Object.entries(messages).flatMap(([key, value]) =>
    typeof value === "string" ? [`${prefix}${key}`] : flatKeys(value, `${prefix}${key}.`)
  );
}
