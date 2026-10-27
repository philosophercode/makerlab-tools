import { getRequestConfig } from "next-intl/server";
import { resolveLocale } from "./locale";
import { ENGLISH, withLabTokens } from "./lab-tokens";
import { withEnglishFallback, type Messages } from "./messages";

export default getRequestConfig(async () => {
  const locale = await resolveLocale();
  // Lab tokens (`{labName}`, …) filled once here (lab config spec §12.2).
  const english = ENGLISH as unknown as Messages;
  if (locale === "en") return { locale, messages: english };

  // Other locales sit on top of English (Article 6, as amended): a key that
  // has not been translated yet renders in English, never as a raw key.
  const messages = withLabTokens((await import(`../../messages/${locale}.json`)).default as Messages);
  return { locale, messages: withEnglishFallback(english, messages) };
});
