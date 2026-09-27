"use client";

import * as React from "react";
import { CheckIcon, MinusIcon } from "lucide-react";
import { Checkbox as CheckboxPrimitive } from "radix-ui";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui Checkbox (Radix), themed: a 16px square bounded by
 * `--outline-strong` (3:1), filled Safety Orange with a near-black mark when
 * checked. `checked="indeterminate"` draws a dash — the "some rows selected"
 * state of a table's select-all box.
 */
function Checkbox({ className, ...props }: React.ComponentProps<typeof CheckboxPrimitive.Root>) {
  return (
    <CheckboxPrimitive.Root
      data-slot="checkbox"
      className={cn(
        "peer size-4 shrink-0 border border-input bg-card transition-colors duration-150",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
        "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive",
        "data-[state=checked]:border-primary data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground",
        "data-[state=indeterminate]:border-primary data-[state=indeterminate]:bg-primary data-[state=indeterminate]:text-primary-foreground",
        className
      )}
      {...props}
    >
      <CheckboxPrimitive.Indicator data-slot="checkbox-indicator" className="grid place-content-center text-current">
        {props.checked === "indeterminate" ? <MinusIcon className="size-3.5" /> : <CheckIcon className="size-3.5" />}
      </CheckboxPrimitive.Indicator>
    </CheckboxPrimitive.Root>
  );
}

export { Checkbox };
