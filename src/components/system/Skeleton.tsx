import { cn } from "@/lib/utils";

/**
 * A placeholder block for a loading page (performance plan, quick win 5 and
 * "Page-shaped admin skeletons"): the size of what will replace it, so the
 * page arrives without a jump. Decorative — the loading state says what is
 * happening in words, once, for a screen reader.
 */
export function SkeletonBlock({ className }: { className?: string }) {
  return <span aria-hidden="true" data-slot="skeleton" className={cn("block bg-muted motion-safe:animate-pulse", className)} />;
}

/** A page header's shape: eyebrow, title, lede. */
export function SkeletonHeader({ className }: { className?: string }) {
  return (
    <div aria-hidden="true" className={cn("flex flex-col gap-3", className)}>
      <SkeletonBlock className="h-3 w-24" />
      <SkeletonBlock className="h-9 w-2/3 max-w-[28rem]" />
      <SkeletonBlock className="h-4 w-full max-w-[40rem]" />
    </div>
  );
}

/** A filter bar over a table: search, then a few facet chips. */
export function SkeletonFilterBar() {
  return (
    <div aria-hidden="true" className="flex flex-wrap items-center gap-2">
      <SkeletonBlock className="h-9 w-full max-w-[18rem]" />
      <SkeletonBlock className="h-9 w-24" />
      <SkeletonBlock className="h-9 w-24" />
      <SkeletonBlock className="h-9 w-28" />
    </div>
  );
}

/** A table: a header row and `rows` body rows, columns in the data table's proportions. */
export function SkeletonTable({ rows = 8 }: { rows?: number }) {
  const cells = ["w-8", "flex-[3]", "flex-[2]", "flex-[2]", "flex-1", "flex-1"];
  return (
    <div aria-hidden="true" className="flex flex-col border border-border">
      {Array.from({ length: rows + 1 }, (_, row) => (
        <div key={row} className={cn("flex items-center gap-4 border-b border-border px-3 last:border-b-0", row === 0 ? "h-10 bg-card" : "h-12")}>
          {cells.map((width, cell) => (
            <SkeletonBlock key={cell} className={cn(width.startsWith("w-") ? width : `${width} min-w-0`, row === 0 ? "h-3" : "h-4")} />
          ))}
        </div>
      ))}
    </div>
  );
}

/** A grid of tiles, as the `/admin` home lays them out. */
export function SkeletonTiles({ count = 8 }: { count?: number }) {
  return (
    <div aria-hidden="true" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: count }, (_, n) => (
        <div key={n} className="flex h-36 flex-col gap-3 border border-border p-4">
          <SkeletonBlock className="h-3 w-28" />
          <SkeletonBlock className="h-8 w-16" />
          <SkeletonBlock className="mt-auto h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}
