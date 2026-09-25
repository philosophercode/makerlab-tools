import Link from "next/link";
import { useTranslations } from "next-intl";
import type { MakerLabTool } from "../catalog-types";
import { locateTool } from "../../lib/map/locate";
import { FloorMap } from "./FloorMap";

/**
 * "Where it is" on the tool page (floor map spec §6.2): the plan as a small
 * picture with the tool's zone (and station, when its map tag names one) in
 * the accent, the place in words beside it, and one "Open map" link to
 * `/map?highlight=…`. The words are the text alternative; the picture is
 * named by a sentence saying the same thing.
 *
 * A tool whose location is not on the map gets the sentence that says so and
 * a link to the whole map — never a guessed zone (Article 4).
 */
export function ToolLocationMap({ tool }: { tool: MakerLabTool }) {
  const t = useTranslations("map");
  const located = locateTool(tool);

  return (
    <section className="td-panel" aria-labelledby="tool-location-heading">
      <header className="td-section-title td-section-title-bordered">
        <h2 id="tool-location-heading">{t("whereHeading")}</h2>
      </header>
      {located ? (
        <div className="ui grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-start">
          <div className="border border-border">
            <FloorMap
              plan={located.plan}
              mode="thumbnail"
              here={located.place}
              labels={{
                title: located.place.station
                  ? t("whereThumbStation", {
                      tool: tool.name,
                      id: located.place.station.id,
                      label: located.place.station.label,
                      number: located.place.zone.number,
                      zone: located.place.zone.zone,
                    })
                  : t("whereThumbTitle", {
                      tool: tool.name,
                      number: located.place.zone.number,
                      zone: located.place.zone.zone,
                      room: located.place.zone.room,
                    }),
                zone: () => "",
                station: () => "",
              }}
            />
          </div>
          <div className="flex flex-col gap-2">
            <p className="font-heading text-2xl font-medium uppercase leading-tight">
              {t("whereZone", { number: located.place.zone.number, zone: located.place.zone.zone })}
            </p>
            <p className="font-mono text-label uppercase text-muted-foreground">
              {t("whereRoom", { room: located.place.zone.room })}
            </p>
            {located.place.station ? (
              <p className="text-sm">
                {t("whereStation", { id: located.place.station.id, label: located.place.station.label })}
              </p>
            ) : null}
            <p>
              <Link className="td-button" href={located.href}>
                {t("openMap")}
              </Link>
            </p>
          </div>
        </div>
      ) : (
        <div className="ui flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground">
            {t("notOnMap", { location: tool.location, zone: tool.zone })}
          </p>
          <Link className="td-button" href="/map">
            {t("openMap")}
          </Link>
        </div>
      )}
    </section>
  );
}
