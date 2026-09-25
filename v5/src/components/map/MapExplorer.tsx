"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { MakerLabTool } from "../catalog-types";
import { GalleryTable } from "../GalleryTable";
import { PageHeader } from "../system/PageHeader";
import { EmptyState } from "../system/EmptyState";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { indexPlan, mapHref, placeTools, resolveHighlight } from "../../lib/map/placement";
import type { FloorPlan } from "../../lib/map/types";
import { FloorMap, type FloorMapLabels } from "./FloorMap";

/**
 * `/map` (floor map spec §6.3): the whole plan with zones shaded by how many
 * tools they hold, a search that lights up where matching tools are, and a
 * side panel with the tools of the picked place in the gallery's own table.
 *
 * State lives in the URL — `?highlight=<station or zone>&q=<search>` — and is
 * written back with `replaceState` (the `GalleryShell` / inventory idiom), so
 * the assistant's "where is the laser cutter?" link and a person's own view
 * are the same kind of link. `?highlight=unplaced` shows the tools the map
 * cannot place.
 */

const SEARCH_KEYS: ReadonlyArray<keyof MakerLabTool> = [
  "name",
  "officialName",
  "category",
  "categorySub",
  "tags",
  "materials",
];

const UNPLACED = "unplaced";

function writeUrl(highlight: string | null, query: string) {
  const params = new URLSearchParams();
  if (highlight) params.set("highlight", highlight);
  if (query.trim()) params.set("q", query.trim());
  const qs = params.toString();
  window.history.replaceState(window.history.state, "", qs ? `/map?${qs}` : "/map");
}

export function MapExplorer({ plan, tools }: { plan: FloorPlan; tools: MakerLabTool[] }) {
  const t = useTranslations("map");
  const params = useSearchParams();
  const [highlight, setHighlight] = useState<string | null>(() => params.get("highlight"));
  const [query, setQuery] = useState(() => params.get("q") ?? "");

  const index = useMemo(() => indexPlan(plan), [plan]);
  const placement = useMemo(() => placeTools(index, tools), [index, tools]);
  const zoneCounts = useMemo(
    () => new Map([...placement.byZone].map(([id, list]) => [id, list.length] as const)),
    [placement]
  );
  const stationCounts = useMemo(
    () => new Map([...placement.byStation].map(([id, list]) => [id, list.length] as const)),
    [placement]
  );

  const matches = useMemo(
    () => (query.trim() ? matchSorter(tools, query.trim(), { keys: SEARCH_KEYS as string[] }) : null),
    [tools, query]
  );
  const matchPlaces = useMemo(() => {
    if (!matches) return null;
    const m = placeTools(index, matches);
    return {
      zones: new Set([...m.byZone].filter(([, list]) => list.length > 0).map(([id]) => id)),
      stations: new Set(m.byStation.keys()),
      unplaced: m.unplaced.length,
    };
  }, [index, matches]);

  const here = highlight && highlight !== UNPLACED ? resolveHighlight(index, highlight) : null;
  const unknownHighlight = highlight && highlight !== UNPLACED && !here ? highlight : null;

  function select(id: string | null) {
    setHighlight(id);
    writeUrl(id, query);
  }

  function search(value: string) {
    setQuery(value);
    writeUrl(highlight, value);
  }

  const labels: FloorMapLabels = {
    title: t("svgTitle", { plan: plan.title }),
    zone: (zone, count) => t("zoneLink", { number: zone.number, zone: zone.zone, room: zone.room, count }),
    station: (station, count) => t("stationLink", { id: station.id, label: station.label, count }),
    zoneCount: (count) => t("zoneCount", { count }),
  };

  // The tools the side panel lists: the picked place's, narrowed by the search.
  let panelTools: MakerLabTool[] = [];
  if (highlight === UNPLACED) panelTools = placement.unplaced;
  else if (here?.station) panelTools = placement.byStation.get(here.station.id) ?? [];
  else if (here) panelTools = placement.byZone.get(here.zone.id) ?? [];
  if (matches) {
    const keep = new Set(matches.map((tool) => tool.id));
    panelTools = panelTools.filter((tool) => keep.has(tool.id));
  }

  const placed = tools.length - placement.unplaced.length;

  return (
    <main className="ui mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-8">
      <PageHeader
        as="h1"
        crumbs={[{ label: t("crumb") }]}
        title={t("title")}
        lede={t("lede")}
        facts={t("facts", {
          zones: plan.zones.length,
          stations: plan.stations.length,
          placed,
          unplaced: placement.unplaced.length,
        })}
      />

      <p className="font-mono text-micro uppercase text-muted-foreground">
        {plan.placeholder ? <strong className="text-warn">{t("placeholder")} </strong> : null}
        {t("source", { source: plan.source, version: plan.version })}
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex min-w-0 flex-1 flex-col gap-1 sm:max-w-md">
          <span className="font-mono text-micro uppercase text-muted-foreground">{t("searchLabel")}</span>
          <Input
            type="search"
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(event) => search(event.target.value)}
          />
        </label>
        {query ? (
          <Button variant="ghost" onClick={() => search("")}>
            {t("clear")}
          </Button>
        ) : null}
      </div>
      <p role="status" className="min-h-5 text-sm text-muted-foreground">
        {matches && query.trim()
          ? `${t("searchSummary", { count: matches.length, query: query.trim() })}${
              matchPlaces && matchPlaces.unplaced > 0 ? ` ${t("searchUnplaced", { count: matchPlaces.unplaced })}` : ""
            }`
          : ""}
      </p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] lg:items-start">
        <div className="border border-border">
          <FloorMap
            plan={plan}
            mode="full"
            labels={labels}
            zoneCounts={zoneCounts}
            stationCounts={stationCounts}
            here={here}
            matchedZones={matchPlaces?.zones}
            matchedStations={matchPlaces?.stations}
            hrefFor={mapHref}
            onSelect={(id) => select(id === highlight ? null : id)}
          />
        </div>

        <aside className="flex min-w-0 flex-col gap-4" aria-label={t("places")}>
          {unknownHighlight ? <EmptyState>{t("unknownHighlight", { id: unknownHighlight })}</EmptyState> : null}

          {here || highlight === UNPLACED ? (
            <section className="flex flex-col gap-2" aria-labelledby="map-selection-heading">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="map-selection-heading" className="font-heading text-xl font-medium uppercase">
                  {highlight === UNPLACED
                    ? t("unplacedHeading")
                    : here?.station
                      ? t("stationHeading", { id: here.station.id, label: here.station.label })
                      : t("zoneHeading", { number: here!.zone.number, zone: here!.zone.zone })}
                </h2>
                <Button variant="ghost" size="sm" onClick={() => select(null)}>
                  {t("showAll")}
                </Button>
              </div>
              <p className="font-mono text-label uppercase text-muted-foreground">
                {highlight === UNPLACED
                  ? t("unplacedBody", { count: placement.unplaced.length })
                  : here?.station
                    ? t("stationIn", { number: here.zone.number, zone: here.zone.zone })
                    : t("inRoom", { room: here!.zone.room })}
              </p>
              <p className="text-sm">{t("toolsHere", { count: panelTools.length })}</p>
              {panelTools.length > 0 ? <GalleryTable tools={panelTools} /> : null}
            </section>
          ) : null}

          <nav aria-labelledby="map-places-heading" className="flex flex-col gap-2">
            <h2 id="map-places-heading" className="font-mono text-label uppercase text-muted-foreground">
              {t("places")}
            </h2>
            <p className="sr-only">{t("placesHint")}</p>
            <ul className="flex flex-col">
              {plan.zones.map((zone) => {
                const stations = plan.stations.filter((s) => s.zoneId === zone.id);
                return (
                  <li key={zone.id} className="border-t border-rule py-1.5">
                    <PlaceLink
                      id={zone.id}
                      current={highlight === zone.id}
                      matched={matchPlaces?.zones.has(zone.id) ?? false}
                      onSelect={select}
                      label={t("zoneHeading", { number: zone.number, zone: zone.zone })}
                      count={zoneCounts.get(zone.id) ?? 0}
                      strong
                    />
                    <ul className="ms-4 flex flex-wrap gap-x-3">
                      {stations.map((station) => (
                        <li key={station.id}>
                          <PlaceLink
                            id={station.id}
                            current={highlight === station.id}
                            matched={matchPlaces?.stations.has(station.id) ?? false}
                            onSelect={select}
                            label={`${station.id} ${station.label}`}
                            count={stationCounts.get(station.id) ?? 0}
                          />
                        </li>
                      ))}
                    </ul>
                  </li>
                );
              })}
              <li className="border-t border-rule py-1.5">
                <PlaceLink
                  id={UNPLACED}
                  current={highlight === UNPLACED}
                  matched={(matchPlaces?.unplaced ?? 0) > 0}
                  onSelect={select}
                  label={t("unplacedHeading")}
                  count={placement.unplaced.length}
                  strong
                />
              </li>
            </ul>
          </nav>
        </aside>
      </div>
    </main>
  );
}

function PlaceLink({
  id,
  label,
  count,
  current,
  matched,
  strong = false,
  onSelect,
}: {
  id: string;
  label: string;
  count: number;
  current: boolean;
  matched: boolean;
  strong?: boolean;
  onSelect: (id: string | null) => void;
}) {
  return (
    <a
      href={mapHref(id)}
      aria-current={current ? "location" : undefined}
      onClick={(event) => {
        event.preventDefault();
        onSelect(current ? null : id);
      }}
      className={[
        "inline-flex min-h-6 items-baseline gap-2 text-sm hover:text-primary-ink",
        strong ? "font-medium" : "text-muted-foreground",
        current ? "text-primary-ink underline underline-offset-4" : "",
        matched ? "text-primary-ink" : "",
      ].join(" ")}
    >
      <span>{label}</span>
      <span className="font-mono text-micro tabular-nums">{count}</span>
    </a>
  );
}
