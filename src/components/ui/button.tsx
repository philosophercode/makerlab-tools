import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Button, themed to the Blueprint Archive (DESIGN.md §8.10): square,
 * mono uppercase 11px label, 150ms colour transitions, a 2px accent-ink focus
 * outline. It replaces seven button families (spec §7.1).
 *
 * - `default` — Safety Orange fill, near-black label (6.8:1): the ONE primary
 *   action on a surface.
 * - `quiet` — hairline box, ink label: everything else. The default variant.
 * - `outline` — accent-ink hairline and label: a secondary call to action on
 *   a public page.
 * - `ghost` — label only, muted until hover: row actions, toolbars, Clear.
 * - `destructive` — bad-tone hairline and label at rest (not only on hover):
 *   discard, delete, ban; confirm inline.
 * - `link` — accent-ink, underlined on hover: inline navigation.
 *
 * Sizes: 32px `default`, 28px `sm` (toolbars, facets), 24px `xs` (row
 * actions), and square `icon` / `icon-sm` (which need an `aria-label`).
 */
const buttonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap",
    "font-mono text-label font-medium uppercase transition-colors duration-150",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
    "disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive",
    "[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  ].join(" "),
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/85",
        quiet: "border border-border bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent",
        outline: "border border-primary-ink/60 bg-transparent text-primary-ink hover:border-primary-ink hover:bg-primary/10",
        ghost: "border border-transparent text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "border border-destructive/70 bg-transparent text-destructive hover:border-destructive hover:bg-destructive/10",
        link: "h-auto border-0 px-0 text-primary-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5",
        xs: "h-6 gap-1 px-2 text-micro",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "quiet",
      size: "default",
    },
  }
);

type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    /** Render the child element (a Next `<Link>`, an `<a>`) with button styling. */
    asChild?: boolean;
  };

function Button({ className, variant = "quiet", size = "default", asChild = false, ...props }: ButtonProps) {
  const Comp = asChild ? Slot.Root : "button";
  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Button, buttonVariants };
export type { ButtonProps };
