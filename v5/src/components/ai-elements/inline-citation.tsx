"use client";

/**
 * AI Elements `InlineCitation`, copied from
 * registry.ai-sdk.dev/inline-citation.json (UI system spec §9.1; phase 5b):
 * a cited phrase with a small mark after it, and a card naming the source.
 *
 * Local edits:
 * - **The mark is the link.** Upstream's trigger is a `Badge` that only opens
 *   a hover card; here it is an `<a>` drawn as a mono badge (`P. 42`) that
 *   opens the manual at that page, and the card opens on hover **or keyboard
 *   focus** (Radix HoverCard) and only repeats, in full, what the link says —
 *   nothing is reachable only through the card.
 * - One source per citation, so the carousel (`embla-carousel`) and its
 *   prev/next/index parts are left out.
 * - The mark's host label (`new URL(...).hostname`) became the caller's
 *   words: a page number means more than a blob host.
 */

import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ComponentProps } from "react";

export type InlineCitationProps = ComponentProps<"span">;

export const InlineCitation = ({ className, ...props }: InlineCitationProps) => (
  <span data-slot="inline-citation" className={cn("group/citation inline", className)} {...props} />
);

export type InlineCitationTextProps = ComponentProps<"span">;

export const InlineCitationText = ({ className, ...props }: InlineCitationTextProps) => (
  <span className={cn("transition-colors duration-150 group-hover/citation:bg-accent", className)} {...props} />
);

export type InlineCitationCardProps = ComponentProps<typeof HoverCard>;

export const InlineCitationCard = (props: InlineCitationCardProps) => (
  <HoverCard closeDelay={100} openDelay={150} {...props} />
);

export type InlineCitationCardTriggerProps = ComponentProps<"a">;

/** The mark after the phrase: a link, drawn as a small mono badge. */
export const InlineCitationCardTrigger = ({ className, ...props }: InlineCitationCardTriggerProps) => (
  <HoverCardTrigger asChild>
    <a
      data-slot="inline-citation-mark"
      target="_blank"
      rel="noreferrer"
      className={cn(
        badgeVariants({ variant: "accent" }),
        "ms-1 align-[0.1em] no-underline! hover:bg-primary/10",
        className
      )}
      {...props}
    />
  </HoverCardTrigger>
);

export type InlineCitationCardBodyProps = ComponentProps<typeof HoverCardContent>;

export const InlineCitationCardBody = ({ className, ...props }: InlineCitationCardBodyProps) => (
  <HoverCardContent className={cn("flex w-72 flex-col gap-2", className)} {...props} />
);

export type InlineCitationSourceProps = ComponentProps<"div"> & {
  title?: string;
  url?: string;
  description?: string;
};

export const InlineCitationSource = ({ title, url, description, className, children, ...props }: InlineCitationSourceProps) => (
  <div className={cn("flex min-w-0 flex-col gap-1", className)} {...props}>
    {title ? <p className="text-sm leading-tight font-medium">{title}</p> : null}
    {description ? <p className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase">{description}</p> : null}
    {url ? <p className="truncate text-xs text-muted-foreground">{url}</p> : null}
    {children}
  </div>
);

export type InlineCitationQuoteProps = ComponentProps<"blockquote">;

export const InlineCitationQuote = ({ children, className, ...props }: InlineCitationQuoteProps) => (
  <blockquote
    className={cn("line-clamp-4 border-s-2 border-s-border ps-3 text-xs leading-snug text-muted-foreground", className)}
    {...props}
  >
    {children}
  </blockquote>
);
