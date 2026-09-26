import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { PageHeader, type PageHeaderProps } from "./PageHeader";

/**
 * The frame of every public working page (UI system phase 5a; DESIGN.md
 * §8.16): projects, about, `/mcp`, `/account/tokens`, the OAuth pages. One
 * reading column on the page background — no panel, no rounded `td-*` card —
 * with a `PageHeader` as the page's h1 and the sections below it.
 *
 * `width="narrow"` (560px) is for a single decision (sign in, consent); the
 * default (880px) is a reading column with room for a table; `wide` is the
 * page width, for a grid of cards (the projects gallery).
 */
export interface PublicPageProps extends Omit<PageHeaderProps, "as"> {
  children: ReactNode;
  width?: "default" | "narrow" | "wide";
  mainClassName?: string;
}

export function PublicPage({ children, width = "default", mainClassName, ...header }: PublicPageProps) {
  return (
    <main
      data-slot="public-page"
      className={cn(
        "ui mx-auto flex w-full min-w-0 flex-col px-4 pt-8 pb-16 sm:px-8",
        width === "narrow" ? "max-w-[624px]" : width === "wide" ? "max-w-[1440px]" : "max-w-[944px]",
        mainClassName
      )}
    >
      <PageHeader as="h1" {...header} />
      {children}
    </main>
  );
}

/**
 * One section of a public page: an h2 (Space Grotesk, uppercase), an optional
 * lede, then the content. Sections are separated by whitespace and nothing
 * else (the No-Line rule). `min-w-0` so a long command scrolls inside its
 * block instead of widening the column.
 */
export function PageSection({
  id,
  title,
  lede,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} data-slot="page-section" className={cn("ui flex min-w-0 flex-col gap-3 pt-8", className)}>
      <h2 id={id} className="font-heading text-lg font-medium uppercase">
        {title}
      </h2>
      {lede ? <div className="max-w-[72ch] text-sm leading-normal text-muted-foreground">{lede}</div> : null}
      {children}
    </section>
  );
}

/** A sub-heading inside a `PageSection`: the mono label style. */
export function SectionLabel({ id, children, as: Heading = "h3" }: { id?: string; children: ReactNode; as?: "h3" | "h4" }) {
  return (
    <Heading id={id} className="pt-2 font-mono text-label tracking-[0.08em] uppercase">
      {children}
    </Heading>
  );
}

/** Running prose on a public page: body size, readable measure, links in the accent ink. */
export function Prose({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex max-w-[72ch] flex-col gap-3 text-[15px] leading-normal [&_a]:text-primary-ink [&_a]:underline [&_a]:underline-offset-4",
        className
      )}
    >
      {children}
    </div>
  );
}
