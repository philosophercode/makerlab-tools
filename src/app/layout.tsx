import type { Metadata } from "next";
import localFont from "next/font/local";
import Image from "next/image";
import Link from "next/link";
import "./globals.css";
import NavLinks from "@/components/NavLinks";
import { ChatProvider } from "@/components/ChatProvider";
import { siteConfig } from "@/lib/site-config";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff2",
  variable: "--font-geist-sans",
  weight: "100 900",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff2",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: `${siteConfig.name} — ${siteConfig.institution}`,
  description: siteConfig.tagline,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen overflow-x-hidden bg-background text-foreground`}
      >
        <header className="sticky top-0 z-50 border-b border-card-border bg-card-bg/80 backdrop-blur-sm">
          <nav className="flex h-14 items-center justify-between px-4">
            <Link href="/" className="flex items-center" aria-label={`${siteConfig.name} home`}>
              <Image
                src={siteConfig.logo}
                alt={siteConfig.name}
                width={1501}
                height={171}
                className="logo-invert-dark h-auto max-h-6 w-auto max-w-[46vw] md:max-h-7"
                priority
              />
            </Link>
            <NavLinks />
          </nav>
        </header>
        <ChatProvider>
          <main>{children}</main>
        </ChatProvider>
      </body>
    </html>
  );
}
