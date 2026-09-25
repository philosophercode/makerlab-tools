import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"
import { Slot } from "radix-ui"

/**
 * shadcn/ui Button, themed to the Blueprint Archive (DESIGN.md §5 Buttons):
 * square, mono uppercase label, one filled accent variant for the single
 * primary action on a surface. `quiet` is the old `.admin-button` — a hairline
 * box in the ink colour — and is the default for everything that is not the
 * primary action.
 */
const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 font-mono text-[11px] font-medium tracking-[0.08em] whitespace-nowrap uppercase transition-colors duration-150 outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "border border-primary bg-primary text-primary-foreground hover:bg-primary/85",
        outline: "border border-primary-ink/60 bg-transparent text-primary-ink hover:bg-primary/10",
        quiet: "border border-border bg-transparent text-foreground hover:border-foreground/40 hover:bg-accent",
        ghost: "text-muted-foreground hover:bg-accent hover:text-foreground",
        destructive: "border border-destructive/70 bg-transparent text-destructive hover:bg-destructive/10",
        link: "h-auto px-0 text-primary-ink underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 px-3",
        sm: "h-7 px-2.5",
        xs: "h-6 gap-1 px-2 text-[10px]",
        icon: "size-8",
        "icon-sm": "size-7",
      },
    },
    defaultVariants: {
      variant: "quiet",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "quiet",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
