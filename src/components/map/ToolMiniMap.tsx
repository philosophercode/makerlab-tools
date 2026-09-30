import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MakerLabTool } from "../catalog-types";
import { locateTool } from "../../lib/map/locate";
import { FloorMap } from "./FloorMap";

/**
 * The mini-map in the tool page's hero: the same plan "Where it is" used to
 * draw large, with the tool's zone (and station) lit, a short zone label over
 * its foot, and the whole plate one link to `/map?highlight=…`.
 *
 * Sized by `DetailShell`'s `tool-hero-media` row. On a phone it sits beside
 * the photo, stretched to the photo's height and taking the width the photo
 * leaves (capped at the photo's own 12rem); from `sm` up it is a 4:3 plate
 * under the photo, the image column's width. Alone (a tool with no photo) it
 * is that plate.
 *
 * A tool that is not on the map gets nothing here — "Where it is" says so.
 */
export function ToolMiniMap({ tool }: { tool: MakerLabTool }) {
  const t = useTranslations("map");
  const located = locateTool(tool);
  if (!located) return null;
  const { zone } = located.place;
  const zoneLabel = t("whereZone", { number: zone.number, zone: zone.zone });

  return (
    <Link
      data-slot="tool-minimap"
      href={located.href}
      aria-label={t("miniMapLabel", { tool: tool.name })}
      className="flex min-h-36 max-w-[12rem] min-w-0 flex-1 flex-col self-stretch overflow-hidden border border-border bg-card hover:border-primary sm:aspect-[4/3] sm:min-h-0 sm:w-full sm:max-w-none sm:flex-none"
    >
      {/* Inside a named link the picture is decoration: the link says where. */}
      <span aria-hidden="true" className="relative min-h-0 flex-1">
        <FloorMap
          plan={located.plan}
          mode="thumbnail"
          here={located.place}
          labels={{ title: zoneLabel, zone: () => "", station: () => "" }}
          // floor-map.css (unlayered) sets `height: auto`; the plate sets the height here.
          className="absolute inset-0 h-full! w-full"
        />
      </span>
      <span
        aria-hidden="true"
        className="truncate border-t border-border px-1.5 py-0.5 font-mono text-micro tracking-[0.04em] text-foreground uppercase"
      >
        {zoneLabel}
      </span>
    </Link>
  );
}
