"use client";

/**
 * AI Elements `Suggestions` / `Suggestion`, copied from
 * registry.ai-sdk.dev/suggestion.json (UI system spec §9; phase 5b). Upstream
 * lays the chips in one row that scrolls sideways inside a `ScrollArea`; the
 * lab's starters are sentences ("How do I wash and cure a print?"), so they
 * stack, one per line, and the `scroll-area` dependency is not needed. The
 * chip is a square `quiet` Button with the sentence in the body face, left
 * aligned and allowed to wrap.
 */

import type { ComponentProps } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type SuggestionsProps = ComponentProps<"div">;

export const Suggestions = ({ className, children, ...props }: SuggestionsProps) => (
  <div data-slot="suggestions" className={cn("flex flex-col items-stretch gap-1.5", className)} {...props}>
    {children}
  </div>
);

export type SuggestionProps = Omit<ComponentProps<typeof Button>, "onClick"> & {
  suggestion: string;
  onClick?: (suggestion: string) => void;
};

export const Suggestion = ({
  suggestion,
  onClick,
  className,
  variant = "quiet",
  size = "default",
  children,
  ...props
}: SuggestionProps) => (
  <Button
    className={cn(
      "h-auto min-h-9 justify-start gap-2.5 bg-card px-3 py-2 text-start font-sans text-table font-normal tracking-normal whitespace-normal normal-case",
      className
    )}
    onClick={() => onClick?.(suggestion)}
    size={size}
    type="button"
    variant={variant}
    {...props}
  >
    {children || suggestion}
  </Button>
);
