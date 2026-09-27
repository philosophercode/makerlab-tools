import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Textarea, themed like `Input` (DESIGN.md §8.7): a square `card`
 * box bounded by `--outline-strong` (3:1), the accent-ink focus outline, and
 * a visible label beside it always — the placeholder is never the label.
 */
function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "min-h-16 w-full min-w-0 border border-input bg-card px-2.5 py-1.5 text-sm leading-normal text-foreground transition-colors duration-150 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  );
}

export { Textarea };
