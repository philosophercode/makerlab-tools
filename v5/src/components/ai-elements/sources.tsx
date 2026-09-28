"use client";

/**
 * AI Elements `Sources`, copied from registry.ai-sdk.dev/sources.json (UI
 * system spec §9.1; phase 5b): a disclosure under an answer listing what it
 * cited. Here the sources are manual pages ("Form 4 Manual, p. 42"), each a
 * link that opens the PDF at that page.
 *
 * Local edits: the trigger's words are the caller's (translated, with the
 * count — upstream says "Used N sources" in English); it is a mono label in
 * muted ink with a chevron that turns, not orange prose; each source is a
 * ruled row with a book icon and the citation, the link in the accent ink;
 * the open/close is a fade (no slide: motion is colour and opacity).
 */

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { BookOpenIcon, ChevronDownIcon } from "lucide-react";
import type { ComponentProps } from "react";

export type SourcesProps = ComponentProps<typeof Collapsible>;

export const Sources = ({ className, ...props }: SourcesProps) => (
  <Collapsible data-slot="sources" className={cn("w-full", className)} {...props} />
);

export type SourcesTriggerProps = ComponentProps<typeof CollapsibleTrigger>;

export const SourcesTrigger = ({ className, children, ...props }: SourcesTriggerProps) => (
  <CollapsibleTrigger
    className={cn(
      "group/sources inline-flex cursor-pointer items-center gap-1.5 font-mono text-label tracking-[0.08em] text-muted-foreground uppercase transition-colors duration-150 hover:text-foreground",
      className
    )}
    {...props}
  >
    {children}
    <ChevronDownIcon aria-hidden="true" className="size-3.5 transition-transform duration-150 group-data-[state=open]/sources:rotate-180" />
  </CollapsibleTrigger>
);

export type SourcesContentProps = ComponentProps<typeof CollapsibleContent>;

export const SourcesContent = ({ className, ...props }: SourcesContentProps) => (
  <CollapsibleContent
    className={cn(
      "mt-2 flex flex-col border-t border-rule",
      "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
);

export type SourceProps = ComponentProps<"a">;

export const Source = ({ href, title, children, className, ...props }: SourceProps) => (
  <a
    className={cn(
      "flex items-start gap-2 border-b border-rule py-1.5 text-table text-primary-ink underline-offset-4 hover:underline",
      className
    )}
    href={href}
    rel="noreferrer"
    target="_blank"
    {...props}
  >
    {children ?? (
      <>
        <BookOpenIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0">{title}</span>
      </>
    )}
  </a>
);
