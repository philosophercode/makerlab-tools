"use client";

/**
 * AI Elements `Suggestions` / `Suggestion`, copied from the registry
 * (registry.ai-sdk.dev/suggestion.json). Adapted for the chat panel (UI system
 * spec §8): the upstream row scrolls sideways inside a shadcn `ScrollArea`;
 * the lab's starters are sentences, so they stack instead (`layout="stack"`,
 * the default here) and the ScrollArea dependency is not needed. The chip is
 * square, per DESIGN.md.
 */

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SuggestionsProps = ComponentProps<"div"> & { layout?: "stack" | "row" };

export const Suggestions = ({ className, children, layout = "stack", ...props }: SuggestionsProps) => (
  <div
    className={cn(
      layout === "stack" ? "flex flex-col gap-1.5" : "flex w-full flex-nowrap items-center gap-2 overflow-x-auto",
      className
    )}
    {...props}
  >
    {children}
  </div>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({ suggestion, onClick, className, variant = "quiet", size = "default", children, ...props }: SuggestionProps) => (
  <Button
    className={cn("h-auto min-h-9 justify-start gap-2.5 px-3 py-2 text-left font-sans text-[13px] tracking-normal normal-case", className)}
    onClick={() => onClick?.(suggestion)}
    size={size}
    type="button"
    variant={variant}
    {...props}
  >
    {children || suggestion}
  </Button>
);
