import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./locale";
import { withEnglishFallback, type Messages } from "./messages";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  const english = (await import("../../messages/en.json")).default as Messages;
  if (locale === "en") return { locale, messages: english };

  // Other locales sit on top of English (Article 6, as amended): a key that
  // has not been translated yet renders in English, never as a raw key.
  const messages = (await import(`../../messages/${locale}.json`)).default as Messages;
  return { locale, messages: withEnglishFallback(english, messages) };
});
