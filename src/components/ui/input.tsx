import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Input, themed (DESIGN.md §8.7): a square `card` field, 32px tall,
 * bounded by `--outline-strong` so the control is findable (3:1, WCAG
 * 1.4.11 — the old `--outline` hairline was 1.5:1). Always paired with a
 * visible label; the placeholder is never the label.
 */
function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-8 w-full min-w-0 border border-input bg-card px-2.5 text-sm text-foreground transition-colors duration-150 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground",
        "file:inline-flex file:h-6 file:border-0 file:bg-transparent file:font-mono file:text-label file:uppercase",
        "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Input };
