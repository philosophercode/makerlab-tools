"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { Dialog as SheetPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Sheet (Radix Dialog), themed to the Blueprint Archive (DESIGN.md
 * §8.8): a panel from an edge of the screen — full height, square, a hairline
 * on its open side, the 28% ink scrim, fade only (no slide: motion is colour
 * and opacity). A workspace, not a decision; Radix supplies the focus trap,
 * Escape and focus return. Users: the phone's Filters panel (`FilterBar`) and
 * the chat (phase 5b), which draws its own close button in its header
 * (`showCloseButton={false}` with a `SheetClose`).
 */

function Sheet(props: React.ComponentProps<typeof SheetPrimitive.Root>) {
  return <SheetPrimitive.Root data-slot="sheet" {...props} />;
}

function SheetTrigger(props: React.ComponentProps<typeof SheetPrimitive.Trigger>) {
  return <SheetPrimitive.Trigger data-slot="sheet-trigger" {...props} />;
}

function SheetClose(props: React.ComponentProps<typeof SheetPrimitive.Close>) {
  return <SheetPrimitive.Close data-slot="sheet-close" {...props} />;
}

const SIDES = {
  right: "inset-y-0 end-0 h-full w-[min(22rem,100%)] border-s",
  left: "inset-y-0 start-0 h-full w-[min(22rem,100%)] border-e",
  bottom: "inset-x-0 bottom-0 max-h-[85vh] border-t",
} as const;

function SheetContent({
  className,
  children,
  side = "right",
  closeLabel,
  showCloseButton = true,
  ...props
}: React.ComponentProps<typeof SheetPrimitive.Content> & {
  side?: keyof typeof SIDES;
  /** The close button's accessible name, translated. Required when it shows. */
  closeLabel?: string;
  /** False when the sheet draws its own `SheetClose` (the chat's header). */
  showCloseButton?: boolean;
}) {
  return (
    <SheetPrimitive.Portal data-slot="sheet-portal">
      <SheetPrimitive.Overlay
        data-slot="sheet-overlay"
        className="fixed inset-0 z-50 bg-black/28 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
      />
      <SheetPrimitive.Content
        data-slot="sheet-content"
        className={cn(
          "ui fixed z-50 flex flex-col gap-4 overflow-y-auto border-border bg-popover p-4 text-popover-foreground outline-hidden",
          "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
          SIDES[side],
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton ? (
          <SheetPrimitive.Close
            data-slot="sheet-close"
            aria-label={closeLabel}
            className="absolute end-3 top-3 inline-flex size-7 items-center justify-center text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid [&_svg]:size-4"
          >
            <XIcon aria-hidden="true" />
          </SheetPrimitive.Close>
        ) : null}
      </SheetPrimitive.Content>
    </SheetPrimitive.Portal>
  );
}

function SheetTitle({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Title>) {
  return (
    <SheetPrimitive.Title
      data-slot="sheet-title"
      className={cn("pe-8 font-heading text-lg leading-none font-medium uppercase", className)}
      {...props}
    />
  );
}

function SheetDescription({ className, ...props }: React.ComponentProps<typeof SheetPrimitive.Description>) {
  return <SheetPrimitive.Description data-slot="sheet-description" className={cn("text-sm text-muted-foreground", className)} {...props} />;
}

export { Sheet, SheetClose, SheetContent, SheetDescription, SheetTitle, SheetTrigger };
