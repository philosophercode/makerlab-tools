"use client";

import { useMemo } from "react";
import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import { mergeClientMessages } from "../i18n/client-messages";
import type { Messages } from "../i18n/messages";

/**
 * Adds a layout's own client translations to the ones the root layout sent
 * (`i18n/client-messages.ts`): only the added namespaces cross the wire, and
 * the components below see both. The locale, time zone and formats are the
 * parent provider's.
 */
export function MessagesScope({ messages, children }: { messages: Messages; children: React.ReactNode }) {
  const locale = useLocale();
  const parent = useMessages() as Messages;
  const merged = useMemo(() => mergeClientMessages(parent, messages), [parent, messages]);
  return (
    <NextIntlClientProvider locale={locale} messages={merged}>
      {children}
    </NextIntlClientProvider>
  );
}
