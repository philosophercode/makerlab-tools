import type { ReactElement, ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import {
  render as rtlRender,
  type RenderOptions,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import enMessages from "../../messages/en.json";
import { ChatLauncherProvider } from "../../src/components/ChatLauncherContext";

type Messages = typeof enMessages;

interface ProvidersOptions {
  /** BCP-47 locale passed to the i18n provider. Defaults to "en". */
  locale?: string;
  /** Override the message catalog (defaults to messages/en.json). */
  messages?: Messages;
}

/**
 * Custom RTL render that wraps the UI in `NextIntlClientProvider` so
 * i18n-aware components (anything using `useTranslations`) render without
 * throwing. Components that don't use i18n can use this harmlessly.
 *
 *   import { render, screen, userEvent } from "@/../test/utils/render";
 *   render(<ToolCard tool={availableTool} />);
 */
export function render(
  ui: ReactElement,
  { locale = "en", messages = enMessages, ...options }: ProvidersOptions &
    Omit<RenderOptions, "wrapper"> = {}
) {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={messages}>
        <ChatLauncherProvider>{children}</ChatLauncherProvider>
      </NextIntlClientProvider>
    );
  }
  return rtlRender(ui, { wrapper: Wrapper, ...options });
}

// Re-export the full RTL surface so test files import everything from here.
export * from "@testing-library/react";
export { userEvent };
