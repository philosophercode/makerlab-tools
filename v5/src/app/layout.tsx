import type { Metadata } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import "../styles/globals.css";
import { ChatFab } from "../components/ChatFab";
import { ChatLauncherProvider } from "../components/ChatLauncherContext";
import { GlobalChrome } from "../components/GlobalChrome";
import { DemoDataBanner } from "../components/DemoDataBanner";
import { ThemeScript } from "../components/ThemeScript";
import { LocaleHtmlScript } from "../components/LocaleHtmlScript";
import { getCatalogStats } from "../lib/catalog";
import { siteConfig } from "../lib/site-config";

export const metadata: Metadata = {
  title: `${siteConfig.name}`,
  description: `Technical Schematic tool catalog for ${siteConfig.institution} MakerLab.`,
};

// Brand colors come from NEXT_PUBLIC_* env (inlined at build), so an inline
// style on <html> re-themes via env without editing globals.css. Cast keeps
// the custom-property keys typed.
const brandColorVars = {
  "--primary": siteConfig.colors.primary,
  "--primary-dark": siteConfig.colors.primaryDark,
} as React.CSSProperties;

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const catalogStats = await getCatalogStats();

  // The <html> shell is rendered statically (Cache Components). Locale is
  // request data (a cookie), so it can't be read at the static root — instead,
  // `LocaleHtmlScript` corrects `lang`/`dir` before paint, and the localized
  // chrome/content streams in via Suspense boundaries below.
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning style={brandColorVars}>
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
      <ChatLauncherProvider>
        <GlobalChrome stats={catalogStats} />
        <DemoDataBanner />
        {children}
        <Suspense fallback={null}>
          <ChatFab />
        </Suspense>
      </ChatLauncherProvider>
    </NextIntlClientProvider>
  );
}
