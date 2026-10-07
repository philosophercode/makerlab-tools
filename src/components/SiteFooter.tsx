import Link from "next/link";
import { useTranslations } from "next-intl";
import { ABOUT_LINKS } from "../app/about/about-content";
import { siteConfig } from "../lib/site-config";
import { BrandLogo } from "./BrandLogo";

const LINKS = [
  { key: "product", href: "/product" },
  { key: "quickStart", href: "/product/quick-start" },
  { key: "about", href: "/about" },
  { key: "mcp", href: "/mcp" },
] as const;

/**
 * The site footer (identity spec amendment 2026-09-28 "Product page and quick
 * start"): the product page, the quick start, About and MCP — pages worth
 * finding that do not belong in the main nav — and the lab's official page.
 * Drawn on every page except the kiosk (the root layout wraps it in
 * `SiteChrome`). One mono line, a hairline above, and the lab's official
 * logo at its start (amendment 2026-10-06), in the text colour like the
 * header's wordmark. On a narrower window the three wrap, the logo first.
 */
export function SiteFooter() {
  const t = useTranslations("footer");
  return (
    <footer data-slot="site-footer" className="ui mt-auto border-t border-rule">
      <div className="mx-auto flex w-full max-w-[1440px] flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-6 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase sm:px-8">
        <BrandLogo className="h-10 text-foreground" />
        <nav aria-label={t("label")}>
          <ul className="flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
            {LINKS.map(({ key, href }) => (
              <li key={key}>
                <Link href={href} className="hover:text-foreground">
                  {t(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <p>
          {siteConfig.name} ·{" "}
          <a href={ABOUT_LINKS.official} className="hover:text-foreground">
            {t("official")}
          </a>
        </p>
      </div>
    </footer>
  );
}
