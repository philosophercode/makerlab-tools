"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import { ArrowLeft } from "lucide-react";
import type { MakerLabTool } from "../catalog-types";
import { GalleryTable } from "../GalleryTable";
import { useGalleryColumns } from "../gallery-columns";
import { PageHeader, type Crumb } from "../system/PageHeader";
import { EmptyState } from "../system/EmptyState";
import { Input } from "../ui/input";
import { Button } from "../ui/button";
import { indexPlan, mapHref, placeTools, resolveHighlight } from "../../lib/map/placement";
import type { FloorPlan } from "../../lib/map/types";
import { FloorMap, type FloorMapLabels } from "./FloorMap";
import { MAP_UNPLACED, mapPlaceUrl } from "./map-url";
import { PlaceChip, PlaceLink } from "./PlaceLink";

/**
 * `/map` (floor map spec §6.3): the whole plan with zones shaded by how many
 * tools they hold, a search that lights up where matching tools are, and a
 * side panel with the tools of the picked place in the gallery's own table.
 *
 * **The place is navigation, the search is not** (map UX pass): picking a
 * zone or station *pushes* `?highlight=` onto the history, so the browser's
 * Back button (and a phone's back gesture) returns to the whole map; typing a
 * search *replaces* `?q=` so keystrokes never pile onto Back. The picked
 * place is read from `useSearchParams`, which Next keeps in step with
 * `history.pushState`, Back/Forward and `<Link>` alike — the breadcrumb's
 * "Map" link and the header's nav both clear it with no state of their own.
 *
 * The way out of a place is always in reach: the zone bar ("All zones"
 * first) — right above the map on a phone, beside it from lg — a "Whole map"
 * button at the head of the panel, the breadcrumb, and Escape.
 * `?highlight=unplaced` shows the tools the map cannot place.
 *
 * **The map is above the fold** (amendment 2026-10-07): a compact header, the
 * hint, search and zone bar beside the map from lg, the source line under it,
 * and the map's column sized to the window's height (`.map-layout`,
 * floor-map.css).
 */

const SEARCH_KEYS: ReadonlyArray<keyof MakerLabTool> = [
  "name",
  "officialName",
  "category",
  "categorySub",
  "tags",
  "materials",
];

/** The panel's table: the place is the panel's heading, so no location column; a search's matches keep it. */
const PANEL_HIDDEN = { officialName: false, materials: false, training: false, location: false } as const;
const MATCHES_HIDDEN = { officialName: false, materials: false, training: false, category: false } as const;

export function MapExplorer({ plan, tools }: { plan: FloorPlan; tools: MakerLabTool[] }) {
  const t = useTranslations("map");
  const galleryColumns = useGalleryColumns();
  const params = useSearchParams();
  const highlight = params.get("highlight") || null;
  const [query, setQuery] = useState(() => params.get("q") ?? "");
  const panelHeading = useRef<HTMLHeadingElement>(null);
  const panel = useRef<HTMLElement>(null);
  const focusPanel = useRef(false);
  const zoneBar = useRef<HTMLElement>(null);

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

  const here = highlight && highlight !== MAP_UNPLACED ? resolveHighlight(index, highlight) : null;
  const unknownHighlight = highlight && highlight !== MAP_UNPLACED && !here ? highlight : null;
  const hasPlace = Boolean(here) || highlight === MAP_UNPLACED;

  /** Go to a place (or the whole map): a history entry, so Back undoes it. */
  function select(id: string | null) {
    if (id === highlight) return;
    focusPanel.current = id !== null;
    window.history.pushState(null, "", mapPlaceUrl(id, query));
  }

  function search(value: string) {
    setQuery(value);
    window.history.replaceState(window.history.state, "", mapPlaceUrl(highlight, value));
  }

  // After picking a place, bring its panel to the reader: on a phone it sits
  // under the map, out of sight. Focus names it for a screen reader too.
  useEffect(() => {
    if (!focusPanel.current || !hasPlace) return;
    focusPanel.current = false;
    const heading = panelHeading.current;
    const section = panel.current;
    if (!heading || !section) return;
    heading.focus({ preventScroll: true });
    // The panel's top (its "Whole map" button first) lands below the sticky
    // header — its scroll margin is the header's height.
    const top = section.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.75) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      section.scrollIntoView?.({ block: "start", behavior: reduce ? "auto" : "smooth" });
    }
  }, [highlight, hasPlace]);

  // On a phone the zone bar scrolls sideways: keep the current chip in view.
  useEffect(() => {
    const bar = zoneBar.current;
    const chip = bar?.querySelector<HTMLElement>("[aria-current]");
    if (!bar || !chip || bar.scrollWidth <= bar.clientWidth) return;
    const left = chip.offsetLeft - bar.offsetLeft;
    if (left < bar.scrollLeft || left + chip.offsetWidth > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = Math.max(0, left - 16);
    }
  }, [highlight]);

  // Escape leaves the place for the whole map — unless it belongs to
  // something else: a dialog (the chat, ⌘K) or a search box clearing itself.
  useEffect(() => {
    if (!highlight) return;
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.("[role='dialog'], [role='alertdialog']")) return;
      if (target instanceof HTMLInputElement && target.value) return;
      focusPanel.current = false;
      window.history.pushState(null, "", mapPlaceUrl(null, query));
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [highlight, query]);

  const labels: FloorMapLabels = {
    title: t("svgTitle", { plan: plan.title }),
    zone: (zone, count) => t("zoneLink", { number: zone.number, zone: zone.zone, room: zone.room, count }),
    station: (station, count) => t("stationLink", { id: station.id, label: station.label, count }),
    zoneCount: (count) => t("zoneCount", { count }),
  };

  // The tools the side panel lists: the picked place's, narrowed by the search.
  let panelTools: MakerLabTool[] = [];
  if (highlight === MAP_UNPLACED) panelTools = placement.unplaced;
  else if (here?.station) panelTools = placement.byStation.get(here.station.id) ?? [];
  else if (here) panelTools = placement.byZone.get(here.zone.id) ?? [];
  if (matches) {
    const keep = new Set(matches.map((tool) => tool.id));
    panelTools = panelTools.filter((tool) => keep.has(tool.id));
  }

  const placed = tools.length - placement.unplaced.length;
  const zoneTitle = here ? t("zoneHeading", { number: here.zone.number, zone: here.zone.zone }) : "";
  const stationTitle = here?.station ? t("stationHeading", { id: here.station.id, label: here.station.label }) : "";
  const placeTitle = highlight === MAP_UNPLACED ? t("unplacedHeading") : here?.station ? stationTitle : zoneTitle;

  // The breadcrumb says where you are and is a way back up: Map › Zone › Station.
  const crumbs: Crumb[] = [{ label: t("crumb"), href: hasPlace ? "/map" : undefined }];
  if (here) crumbs.push({ label: zoneTitle, href: here.station ? mapHref(here.zone.id) : undefined });
  if (here?.station) crumbs.push({ label: here.station.id });
  if (highlight === MAP_UNPLACED) crumbs.push({ label: t("unplacedHeading") });

  const zoneStations = here && !here.station ? plan.stations.filter((s) => s.zoneId === here.zone.id) : [];

  return (
    <main className="ui mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-4 py-6 sm:px-8">
      {/* A compact header — breadcrumb, title, facts — so the map starts in
          the first screen (floor map spec amendment "The map above the fold"):
          the lede moved beside the map as the search's hint, the source line
          under it. */}
      <PageHeader
        as="h1"
        crumbs={crumbs}
        title={t("title")}
        className="pb-0"
        facts={t("facts", {
          zones: plan.zones.length,
          stations: plan.stations.length,
          placed,
          unplaced: placement.unplaced.length,
        })}
      />

      {/* One column on a phone — controls, map, places, in reading order; from
          lg the map takes the left column, sized to the window's height, and
          the controls and places sit beside it (floor-map.css `.map-layout`). */}
      <div
        className="map-layout"
        data-slot="map-layout"
        style={{ "--map-aspect": plan.viewBox.w / plan.viewBox.h } as React.CSSProperties}
      >
        <div className="map-controls flex min-w-0 flex-col gap-3" data-slot="map-controls">
          {plan.placeholder ? (
            <p className="font-mono text-micro uppercase">
              <strong className="text-warn">{t("placeholder")}</strong>
            </p>
          ) : null}
          <p className="max-w-[72ch] text-sm leading-normal text-muted-foreground">{t("lede")}</p>

          <div>
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
            {/* Always in the page, so the count is announced; it takes no room until it says something. */}
            <p role="status" className="mt-1.5 text-sm text-muted-foreground empty:mt-0">
              {matches && query.trim()
                ? `${t("searchSummary", { count: matches.length, query: query.trim() })}${
                    matchPlaces && matchPlaces.unplaced > 0 ? ` ${t("searchUnplaced", { count: matchPlaces.unplaced })}` : ""
                  }`
                : ""}
            </p>
          </div>

          {/* The zone bar: every zone one tap away, "All zones" first — beside
              the map from lg, right above it on a phone, so the way back out is
              never hunted for. */}
          <nav ref={zoneBar} aria-label={t("zoneBar")} data-slot="map-zone-bar" className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
            <ul className="flex w-max gap-2 sm:w-auto sm:flex-wrap">
              <li>
                <PlaceChip id={null} current={!highlight} onSelect={select} label={t("allZones")} count={tools.length} />
              </li>
              {plan.zones.map((zone) => (
                <li key={zone.id}>
                  <PlaceChip
                    id={zone.id}
                    current={here?.zone.id === zone.id}
                    matched={matchPlaces?.zones.has(zone.id) ?? false}
                    onSelect={select}
                    label={t("zoneChip", { number: zone.number, zone: zone.zone })}
                    count={zoneCounts.get(zone.id) ?? 0}
                  />
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="map-stage flex min-w-0 flex-col gap-2" data-slot="map-stage">
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
          {/* Where the drawing comes from: worth keeping, not worth the space above the map. */}
          <p className="font-mono text-micro uppercase text-muted-foreground">
            {t("source", { source: plan.source, version: plan.version })}
          </p>
        </div>

        <aside className="map-side flex min-w-0 flex-col gap-4" aria-label={t("places")}>
          {unknownHighlight ? <EmptyState>{t("unknownHighlight", { id: unknownHighlight })}</EmptyState> : null}

          {hasPlace ? (
            <section
              ref={panel}
              data-slot="map-selection"
              className="flex scroll-mt-[calc(var(--sticky-chrome-height)+16px)] flex-col gap-2"
              aria-labelledby="map-selection-heading"
            >
              <p>
                <Button variant="quiet" size="sm" onClick={() => select(null)} data-slot="map-back">
                  <ArrowLeft aria-hidden="true" />
                  {t("backToAll")}
                </Button>
              </p>
              <h2
                id="map-selection-heading"
                ref={panelHeading}
                tabIndex={-1}
                className="font-heading text-xl font-medium uppercase focus-visible:outline-none"
              >
                {placeTitle}
              </h2>
              <p className="font-mono text-label uppercase text-muted-foreground">
                {highlight === MAP_UNPLACED ? (
                  t("unplacedBody", { count: placement.unplaced.length })
                ) : here?.station ? (
                  <a
                    href={mapHref(here.zone.id)}
                    className="underline-offset-4 hover:text-primary-ink hover:underline"
                    onClick={(event) => {
                      event.preventDefault();
                      select(here.zone.id);
                    }}
                  >
                    {t("stationIn", { number: here.zone.number, zone: here.zone.zone })}
                  </a>
                ) : (
                  t("inRoom", { room: here!.zone.room })
                )}
              </p>
              {zoneStations.length > 0 ? (
                <div className="flex flex-col gap-1">
                  <h3 className="font-mono text-micro uppercase text-muted-foreground">{t("stationsHere")}</h3>
                  <ul className="flex flex-wrap gap-2">
                    {zoneStations.map((station) => (
                      <li key={station.id}>
                        <PlaceChip
                          id={station.id}
                          current={false}
                          matched={matchPlaces?.stations.has(station.id) ?? false}
                          onSelect={select}
                          label={`${station.id} ${station.label}`}
                          count={stationCounts.get(station.id) ?? 0}
                          size="sm"
                        />
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <p className="text-sm">{t("toolsHere", { count: panelTools.length })}</p>
              {panelTools.length > 0 ? (
                <GalleryTable
                  tools={panelTools}
                  columns={galleryColumns}
                  visibility={PANEL_HIDDEN}
                  label={t("toolsAt", { place: placeTitle })}
                />
              ) : null}
            </section>
          ) : matches && query.trim() ? (
            // Searching with no place picked: the matches, each with where it is.
            <section data-slot="map-matches" className="flex flex-col gap-2" aria-labelledby="map-matches-heading">
              <h2 id="map-matches-heading" className="font-heading text-xl font-medium uppercase">
                {t("matchesHeading", { query: query.trim() })}
              </h2>
              {matches.length > 0 ? (
                <GalleryTable
                  tools={matches}
                  columns={galleryColumns}
                  visibility={MATCHES_HIDDEN}
                  label={t("matchesHeading", { query: query.trim() })}
                />
              ) : null}
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
                  id={MAP_UNPLACED}
                  current={highlight === MAP_UNPLACED}
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
