import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Badge, themed — for LABELS only: a tag, a category, a tool kind
 * (spec §4.3; it replaces `tool-card-tag`, `admin-tag`, `account-tag`,
 * `mcp-kind`, `td-chip`). **Status is never a Badge**: a status is a
 * `StatusGlyph` (glyph + word), so it is not colour alone and not a pill.
 *
 * - `outline` — hairline box, muted mono label. The default.
 * - `secondary` — a neutral tonal fill, for a label that groups rows.
 * - `accent` — accent-ink hairline and label, for the one label that marks
 *   "yours" or "new" on a surface.
 */
const badgeVariants = cva(
  [
    "inline-flex w-fit shrink-0 items-center gap-1 overflow-hidden border px-1.5 py-px whitespace-nowrap",
    "font-mono text-micro font-medium tracking-[0.08em] uppercase",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "[&>svg]:pointer-events-none [&>svg]:size-3",
  ].join(" "),
  {
    variants: {
      variant: {
        outline: "border-border text-muted-foreground [a&]:hover:border-foreground/40 [a&]:hover:text-foreground",
        secondary: "border-transparent bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/80",
        accent: "border-primary-ink/60 text-primary-ink [a&]:hover:bg-primary/10",
      },
    },
    defaultVariants: {
      variant: "outline",
    },
  }
);

type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & {
    /** Render the child element (a link to the filtered view) with badge styling. */
    asChild?: boolean;
  };

function Badge({ className, variant = "outline", asChild = false, ...props }: BadgeProps) {
  const Comp = asChild ? Slot.Root : "span";
  return <Comp data-slot="badge" data-variant={variant} className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
export type { BadgeProps };
