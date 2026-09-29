import { cn } from "@/lib/utils";
import { mapHref } from "../../lib/map/placement";

/**
 * The `/map` explorer's place links (map UX pass). Real `<a href>`s to the
 * place's `/map?highlight=` view, so they work with no JavaScript and open in
 * a new tab; a plain click is taken by `onSelect` so the explorer can push the
 * place onto the history without a server round trip.
 */

interface PlaceProps {
  /** A zone id, a station tag, `unplaced` — or null for the whole map. */
  id: string | null;
  label: string;
  count: number;
  current: boolean;
  matched?: boolean;
  onSelect: (id: string | null) => void;
}

function follow(onSelect: (id: string | null) => void, id: string | null) {
  return (event: React.MouseEvent<HTMLAnchorElement>) => {
    // Let a modified click (new tab, new window) do what the browser does.
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
    event.preventDefault();
    onSelect(id);
  };
}

/** One row of the "Places" list — the map as text. A second click on the current place goes back to the whole map. */
export function PlaceLink({ id, label, count, current, matched = false, strong = false, onSelect }: PlaceProps & { strong?: boolean }) {
  return (
    <a
      href={id ? mapHref(id) : "/map"}
      aria-current={current ? "location" : undefined}
      onClick={follow(onSelect, current ? null : id)}
      className={cn(
        "inline-flex min-h-8 items-center gap-2 text-sm hover:text-primary-ink",
        strong ? "font-medium" : "text-muted-foreground",
        count === 0 && !strong && !current && "opacity-70",
        current && "text-primary-ink underline underline-offset-4",
        matched && "text-primary-ink"
      )}
    >
      <span>{label}</span>
      <span className="font-mono text-micro tabular-nums">{count}</span>
    </a>
  );
}

/** A chip in the zone bar or a zone's station list: a 36px tap target, the current one filled. */
export function PlaceChip({
  id,
  label,
  count,
  current,
  matched = false,
  size = "default",
  onSelect,
}: PlaceProps & { size?: "default" | "sm" }) {
  return (
    <a
      href={id ? mapHref(id) : "/map"}
      aria-current={current ? "location" : undefined}
      onClick={follow(onSelect, id)}
      data-match={matched ? "true" : undefined}
      className={cn(
        "inline-flex items-center gap-2 border whitespace-nowrap",
        size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm",
        current
          ? "border-foreground bg-foreground text-background"
          : "border-border text-foreground hover:border-foreground/40 hover:bg-accent",
        !current && matched && "border-primary-ink text-primary-ink"
      )}
    >
      <span>{label}</span>
      <span className={cn("font-mono text-micro tabular-nums", current ? "text-background/80" : "text-muted-foreground")}>{count}</span>
    </a>
  );
}
