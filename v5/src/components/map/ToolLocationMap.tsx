import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MakerLabTool } from "../catalog-types";
import { locateTool } from "../../lib/map/locate";
import { Button } from "@/components/ui/button";

/**
 * "Where it is" on the tool page (floor map spec §6.2), compact: the place in
 * words — zone, room, station — on one row, and one "Open full map" link to
 * `/map?highlight=…`. The picture moved up into the hero as the mini-map
 * (`ToolMiniMap`), so the page draws the plan once, small; these words are
 * its text alternative.
 *
 * A tool whose location is not on the map gets the sentence that says so and
 * a link to the whole map — never a guessed zone (Article 4).
 */
export function ToolLocationMap({ tool }: { tool: MakerLabTool }) {
  const t = useTranslations("map");
  const located = locateTool(tool);

  return (
    <section data-slot="tool-location" className="min-w-0" aria-labelledby="tool-location-heading">
      <h2 id="tool-location-heading" className="mb-2 font-heading text-base font-medium uppercase">
        {t("whereHeading")}
      </h2>
      {located ? (
        <div className="ui flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-y border-rule py-2">
          <p className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-heading text-lg leading-tight font-medium uppercase">
              {t("whereZone", { number: located.place.zone.number, zone: located.place.zone.zone })}
            </span>
            <span className="font-mono text-label text-muted-foreground uppercase">{t("whereRoom", { room: located.place.zone.room })}</span>
            {located.place.station ? (
              <span className="text-sm">{t("whereStation", { id: located.place.station.id, label: located.place.station.label })}</span>
            ) : null}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href={located.href}>{t("openFullMap")}</Link>
          </Button>
        </div>
      ) : (
        <div className="ui flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t("notOnMap", { location: tool.location, zone: tool.zone })}
          </p>
          <Button asChild variant="outline" size="sm">
            <Link href="/map">{t("openMap")}</Link>
          </Button>
        </div>
      )}
    </section>
  );
}
