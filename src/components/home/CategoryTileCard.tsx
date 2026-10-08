import Link from "next/link";
import { useTranslations } from "next-intl";
import { ToolImage, type ToolImagePriority } from "../ToolImage";
import { StatusGlyph } from "../system/StatusGlyph";
import { categoryHref } from "../../lib/gallery-links";
import type { CategoryTile } from "./home-tools";

/** A tile is a column of the grid: 2 / 3 / 4 across, the page capped at 1440 px. */
const TILE_IMAGE_SIZES = "(min-width: 1440px) 330px, (min-width: 1280px) 23vw, (min-width: 1024px) 30vw, 46vw";

/**
 * One category on the home page's Categories view: a photo from it, its
 * name, how many tools and its kinds, and, only when some are down, how many
 * units are out of service. The whole tile links to the category's tools
 * (`/?category=…`); with `onSelect`, a plain click opens them in place (a
 * modified click still opens a new tab). Category names are data (English),
 * as on the Category filter.
 */
export function CategoryTileCard({
  tile,
  imagePriority = "lazy",
  onSelect,
}: {
  tile: CategoryTile;
  imagePriority?: ToolImagePriority;
  onSelect?: (name: string) => void;
}) {
  const t = useTranslations("gallery.home");
  const kinds = tile.subs.length > 0 ? `${tile.subs.join(", ")}${tile.moreSubs ? "…" : ""}` : null;
  return (
    <Link
      href={categoryHref(tile.name)}
      onClick={(event) => {
        if (!onSelect || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
        event.preventDefault();
        onSelect(tile.name);
      }}
      data-slot="category-tile"
      className="group flex h-full flex-col border border-border bg-card transition-colors duration-150 hover:border-primary-ink/60"
    >
      {tile.cover ? (
        <ToolImage
          src={tile.cover.imageSrc}
          thumbnails={tile.cover.thumbnails}
          name={tile.cover.name}
          sizes={TILE_IMAGE_SIZES}
          priority={imagePriority}
          className="aspect-[4/3] w-full bg-muted p-6"
        />
      ) : (
        <span aria-hidden="true" className="block aspect-[4/3] w-full bg-muted" />
      )}
      <span className="flex flex-1 flex-col gap-1.5 p-3 sm:p-5">
        <h2 className="font-heading text-[17px] leading-tight font-medium uppercase group-hover:text-primary-ink sm:text-[22px]">
          {tile.name}
        </h2>
        <span className="font-mono text-micro tracking-[0.06em] text-muted-foreground uppercase sm:text-label">
          {t("toolCount", { count: tile.count })}
          {kinds ? <span className="hidden sm:inline"> · {kinds}</span> : null}
        </span>
        {tile.unitsDown > 0 ? (
          <StatusGlyph tone="warn" label={t("unitsDown", { count: tile.unitsDown })} className="mt-auto pt-1 text-micro sm:text-label" />
        ) : null}
      </span>
    </Link>
  );
}
