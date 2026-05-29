import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import "../styles/globals.css";
import { ChatFab } from "../components/ChatFab";
import { GlobalChrome } from "../components/GlobalChrome";
import { ThemeScript } from "../components/ThemeScript";
import { LocaleHtmlScript } from "../components/LocaleHtmlScript";
import { getCatalogStats } from "../lib/catalog";

export const metadata: Metadata = {
  title: "MakerLab Tools v5",
  description: "Technical Schematic tool catalog for Cornell Tech MakerLab.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const catalogStats = await getCatalogStats();

  // The <html> shell is rendered statically (Cache Components). Locale is
  // request data (a cookie), so it can't be read at the static root — instead,
  // `LocaleHtmlScript` corrects `lang`/`dir` before paint, and the localized
  // chrome/content streams in via Suspense boundaries below.
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        <ThemeScript />
        <LocaleHtmlScript />
      </head>
      <body>
        <Suspense fallback={null}>
          <LocalizedTree catalogStats={catalogStats}>{children}</LocalizedTree>
        </Suspense>
      </body>
    </html>
  );
}

async function LocalizedTree({
  catalogStats,
  children,
}: {
  catalogStats: Awaited<ReturnType<typeof getCatalogStats>>;
  children: React.ReactNode;
}) {
  return (
    <NextIntlClientProvider>
      <GlobalChrome stats={catalogStats} />
      {children}
      <Suspense fallback={null}>
        <ChatFab />
      </Suspense>
    </NextIntlClientProvider>
  );
}
