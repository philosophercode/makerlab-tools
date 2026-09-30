import * as React from "react";
import { ChevronDownIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * shadcn/ui NativeSelect, themed like `Input` (DESIGN.md §8.7): a real
 * `<select>` — so the browser's own picker on a phone, a `combobox` role, and
 * `selectOptions` in tests — in a square `card` box bounded by
 * `--outline-strong` (3:1), 32px tall (`size="sm"`: 28px), with a chevron
 * drawn over the native arrow. Used where a value is picked from a short fixed
 * list inside a form or a row (a role, an expiry); a facet over a table is a
 * `FacetFilter` menu instead.
 */
function NativeSelect({
  className,
  size = "default",
  ...props
}: Omit<React.ComponentProps<"select">, "size"> & { size?: "default" | "sm" }) {
  return (
    <div data-slot="native-select-wrapper" className={cn("relative inline-flex w-fit min-w-0", className)}>
      <select
        data-slot="native-select"
        data-size={size}
        className={cn(
          "w-full min-w-0 appearance-none border border-input bg-card ps-2.5 pe-8 text-sm text-foreground transition-colors duration-150",
          size === "sm" ? "h-7 text-table" : "h-8",
          "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring focus-visible:outline-solid",
          "disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:border-destructive"
        )}
        {...props}
      />
      <ChevronDownIcon
        aria-hidden="true"
        className="pointer-events-none absolute end-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
      />
    </div>
  );
}

export { NativeSelect };
