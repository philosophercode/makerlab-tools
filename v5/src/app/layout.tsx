import type { Metadata } from "next";
import "../styles/globals.css";
import { ChatFab } from "../components/ChatFab";
import { GlobalChrome } from "../components/GlobalChrome";
import { ThemeScript } from "../components/ThemeScript";
import { getCatalogStats } from "../lib/catalog";

export const metadata: Metadata = {
  title: "MakerLab Tools v5",
  description: "Technical Schematic tool catalog for Cornell Tech MakerLab.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const catalogStats = await getCatalogStats();

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <ThemeScript />
      </head>
      <body>
        <GlobalChrome stats={catalogStats} />
        {children}
        <ChatFab />
      </body>
    </html>
  );
}
