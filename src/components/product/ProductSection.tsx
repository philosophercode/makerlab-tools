import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A section of the product pages: an h2 in Space Grotesk at page-title size
 * (the page has a display h1 above it), an optional lede, then the content.
 * Sections are separated by whitespace only (the No-Line rule).
 */
export function ProductSection({
  id,
  title,
  lede,
  children,
  className,
}: {
  id: string;
  title: ReactNode;
  lede?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section aria-labelledby={id} data-slot="product-section" className={cn("flex min-w-0 flex-col gap-4 pt-16 sm:pt-20", className)}>
      <div className="flex max-w-[72ch] flex-col gap-2">
        <h2 id={id} className="font-heading text-[26px] leading-[1.05] font-medium normal-case sm:text-[32px]">
          {title}
        </h2>
        {lede ? <p className="text-[15px] leading-normal text-muted-foreground">{lede}</p> : null}
      </div>
      {children}
    </section>
  );
}
