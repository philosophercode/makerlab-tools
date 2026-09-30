import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "next-intl/server";
// The UI system (Tailwind theme + utilities, shadcn tokens) first, so its
// cascade-layer order is declared before globals.css adds to `base`.
import "../styles/ui.css";
import "../styles/globals.css";
import { fontVariables } from "./fonts";
import { ChatFab } from "../components/ChatFab";
import { ChatLauncherProvider } from "../components/ChatLauncherContext";
import { PageSelectionProvider } from "../components/chat/page-selection";
import { GlobalChrome } from "../components/GlobalChrome";
import { DemoDataBanner } from "../components/DemoDataBanner";
import { SiteChrome } from "../components/SiteChrome";
import { SiteFooter } from "../components/SiteFooter";
import { AskParamOpener } from "../components/AskParamOpener";
import { UsageBeacon } from "../components/usage/UsageBeacon";
import { ThemeScript } from "../components/ThemeScript";
import { LocaleHtmlScript } from "../components/LocaleHtmlScript";
import { getCatalogStats, getPaletteTools } from "../lib/catalog";
import { siteConfig } from "../lib/site-config";
import { baseOpenGraph, SITE_DESCRIPTION } from "../lib/share/metadata";
import { siteUrl } from "../lib/share/site-url";
import { publicClientMessages } from "../i18n/client-messages";
import type { Messages } from "../i18n/messages";

/**
 * Every page's title is "<page> · <site>" through the template; a page names
 * only itself. The link preview (`opengraph-image.tsx`, `twitter-image.tsx`)
 * is the site card unless a page names its own image; `openGraph` and
 * `twitter` carry no title or description here, so each page's own are used
 * (Next fills them from the page's `title` and `description`).
 */
export const metadata: Metadata = {
  metadataBase: siteUrl(),
  title: { default: siteConfig.name, template: `%s · ${siteConfig.name}` },
  // The site's tagline, and what it is (identity spec 2026-09-28 §1).
  description: SITE_DESCRIPTION,
  applicationName: siteConfig.name,
  openGraph: baseOpenGraph(),
  twitter: { card: "summary_large_image" },
};

/** The browser chrome takes the page's paper (light) or ink (dark) colour. */
export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f4ee" },
    { media: "(prefers-color-scheme: dark)", color: "#0f0f0f" },
  ],
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
  const paletteTools = await getPaletteTools();

  // The <html> shell is rendered statically (Cache Components). Locale is
  // request data (a cookie), so it can't be read at the static root — instead,
  // `LocaleHtmlScript` corrects `lang`/`dir` before paint, and the localized
  // chrome/content streams in via Suspense boundaries below.
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning style={brandColorVars} className={fontVariables}>
      <head>
        <ThemeScript />
        <LocaleHtmlScript />
      </head>
      <body>
        <Suspense fallback={null}>
          <LocalizedTree catalogStats={catalogStats} paletteTools={paletteTools}>
            {children}
          </LocalizedTree>
        </Suspense>
      </body>
    </html>
  );
}

async function LocalizedTree({
  catalogStats,
  paletteTools,
  children,
}: {
  catalogStats: Awaited<ReturnType<typeof getCatalogStats>>;
  paletteTools: Awaited<ReturnType<typeof getPaletteTools>>;
  children: React.ReactNode;
}) {
  // Only the translations client components on public pages use; admin and
  // account layouts add their own (`i18n/client-messages.ts`).
  const messages = publicClientMessages((await getMessages()) as Messages);
  return (
    <NextIntlClientProvider messages={messages}>
      <ChatLauncherProvider>
        <PageSelectionProvider>
          <SiteChrome>
            <GlobalChrome stats={catalogStats} paletteTools={paletteTools} />
            <DemoDataBanner />
          </SiteChrome>
          {children}
          <SiteChrome>
            <SiteFooter />
          </SiteChrome>
          <Suspense fallback={null}>
            <ChatFab />
          </Suspense>
          {/* Its own boundary: it reads the query string, which a prerender
              cannot, and must not take the chat button out of the HTML with it. */}
          <Suspense fallback={null}>
            <AskParamOpener />
            {/* Counts an arrival from the kiosk's QR code (`?src=kiosk`), nothing else. */}
            <UsageBeacon kind="kiosk_view" />
          </Suspense>
        </PageSelectionProvider>
      </ChatLauncherProvider>
    </NextIntlClientProvider>
  );
}
