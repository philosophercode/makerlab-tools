import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import type { MakerLabTool } from "../catalog-types";
import type { FloorPlan } from "../../lib/map/types";
import { planWork } from "../../lib/map/work-plan";
import { FloorMap } from "./FloorMap";

/**
 * "Where you'll work" on a project page (map UX pass; the owner's "it would
 * help you know where all the tools are"): the plan as a small picture with
 * every zone holding one of the project's tools lit, and the tools grouped by
 * zone beside it — each zone a link to its `/map` view, each tool to its page.
 *
 * Its own component, not `ToolLocationMap`: that one is the tool page's and
 * is being reshaped separately. It shares `FloorMap`'s thumbnail mode, which
 * draws the matched stations as well as "here". Rendered only by
 * `SignedInProjectWorkMap`, so a signed-out visitor is sent none of it.
 */
export function ProjectWorkMap({ plan, tools }: { plan: FloorPlan; tools: MakerLabTool[] }) {
  const t = useTranslations("map");
  const work = planWork(plan, tools);
  const zoneNames = work.zones.map((z) => z.zone.number).join(", ");

  return (
    <section data-slot="project-work-map" aria-labelledby="project-work-map-heading" className="flex min-w-0 flex-col gap-3 pt-8">
      <div className="flex flex-col gap-1">
        <h2 id="project-work-map-heading" className="font-heading text-base font-medium uppercase">
          {t("workHeading")}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t("workLede", { tools: tools.length, zones: work.zones.length })}
        </p>
      </div>
      <div className="ui grid gap-4 sm:grid-cols-[minmax(0,320px)_1fr] sm:items-start">
        {work.zones.length > 0 ? (
          <div className="border border-border">
            <FloorMap
              plan={plan}
              mode="thumbnail"
              matchedZones={work.zoneIds}
              matchedStations={work.stationIds}
              labels={{ title: t("workSvgTitle", { count: work.zones.length, zones: zoneNames }), zone: () => "", station: () => "" }}
            />
          </div>
        ) : null}
        <ol className="m-0 flex min-w-0 list-none flex-col gap-3 p-0">
          {work.zones.map(({ zone, href, tools: entries }) => (
            <li key={zone.id} data-zone={zone.id} className="border-t border-rule pt-1.5">
              <Link href={href} className="group flex items-baseline justify-between gap-3">
                <span className="font-heading text-sm font-medium uppercase group-hover:text-primary-ink group-hover:underline">
                  {t("zoneHeading", { number: zone.number, zone: zone.zone })}
                </span>
                <span className="font-mono text-micro uppercase text-muted-foreground">{t("workOpenZone")}</span>
              </Link>
              <ul className="m-0 mt-1 list-none p-0">
                {entries.map(({ tool, station }) => (
                  <li key={tool.id}>
                    <Link href={`/tools/${tool.slug}`} className="group flex min-h-8 items-center justify-between gap-3 text-table">
                      <span className="min-w-0 group-hover:text-primary-ink group-hover:underline">{tool.name}</span>
                      <span className="flex items-center gap-2">
                        {station ? <code className="font-mono text-micro text-muted-foreground">{station.id}</code> : null}
                        <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ))}
          {work.unplaced.length > 0 ? (
            <li data-zone="unplaced" className="border-t border-rule pt-1.5">
              <p className="font-heading text-sm font-medium uppercase text-muted-foreground">{t("unplacedHeading")}</p>
              <ul className="m-0 mt-1 list-none p-0">
                {work.unplaced.map((tool) => (
                  <li key={tool.id}>
                    <Link href={`/tools/${tool.slug}`} className="group flex min-h-8 items-center justify-between gap-3 text-table">
                      <span className="min-w-0 group-hover:text-primary-ink group-hover:underline">{tool.name}</span>
                      <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </li>
          ) : null}
        </ol>
      </div>
    </section>
  );
}
