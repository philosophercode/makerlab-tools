import { DEFAULT_LOCALE, getLocaleOption, isSupportedLocale, type LocaleOption } from "../../i18n/config";
import { withEnglishFallback, type Messages } from "../../i18n/messages";

/**
 * The kiosk's language (kiosk spec §6): the default locale unless `?lang=`
 * names a supported one. Not the cookie and not `Accept-Language` — the screen
 * is read by everybody in the room, not by the browser it runs in.
 */
export function kioskLocale(lang: string | string[] | undefined): LocaleOption {
  const code = typeof lang === "string" && isSupportedLocale(lang) ? lang : DEFAULT_LOCALE;
  return getLocaleOption(code);
}

/** The `kiosk` namespace in `code`, English underneath (Article 6). */
export async function kioskMessages(code: string): Promise<Messages> {
  const english = (await import("../../../messages/en.json")).default as Messages;
  const messages =
    code === DEFAULT_LOCALE
      ? english
      : withEnglishFallback(english, (await import(`../../../messages/${code}.json`)).default as Messages);
  return { kiosk: messages.kiosk };
}
