# Floor Map — Design Spec

**Date:** 2026-09-25
**Status:** Draft
**Target:** `v5/`
**Branch:** `v5/map-spike` (spike; not for merge as-is)
**Spec PR:** — · **Implementation PR:** — (one per phase, §9)

## 1. Summary

The lab has a real zone plan: **"Latest MakerLAB zone plan.jpg"** (4289×3102,
2026-07-24, "MakerLAB @ Cornell Tech, Studio 101, TATA Innovation Center"),
kept outside this repository in `~/Developer/Projects/MakerLab_Tools/`. It
draws five numbered **zones** (1 Common Purpose Space, 2 3D Printing Hub,
3 Machining Shop, 4 Laser Machine Room, 5 Electronics Lab) and seventeen
lettered **stations** (`1A` Lounge … `4B` Epilog Laser Machine). The zone names
are exactly the `locations.zone` values the Notion import wrote, and the
station codes are the vocabulary `locations.map_tag` was created for ("the
printed label on the floor map"). Nothing in the app shows it today: the tool
page prints the tag as a code (`MAP ID 1C`) and nobody can see where that is.

This spec adds a **floor map**: the zone plan traced into a clean Blueprint
schematic (inline SVG: 0px radii, mono labels, dot grid), a small map on
every tool page with the tool's zone — and station, when its tag names one —
in the accent, a public `/map` page that shades zones by how many tools they
hold, lists a place's tools in the gallery's table and lights up search
matches, and a `map` field on the assistant's `get_tool_details` so "where is
the laser cutter?" is answered in words with a `/map?highlight=4A` link.

No architecture change. The plan is data in the repository for the first
phase; a `floor_plans` table and an admin upload come later (§4.3, §9).

## 2. Goals / Non-goals

### Goals

- A student on a tool page sees, without scrolling past Safety, which zone
  (and station) the tool is in, as a picture **and** as words, with one link to
  the full map.
- `/map` answers "what is in the Machining Shop?" and "where are the laser
  cutters?" with no sign-in, and every view is a link (`?highlight=`, `?q=`).
- The assistant answers "where is X?" from data — zone, room, station — and
  links the map; a tool that is not on the map is said to be not on the map,
  never guessed.
- A tool is placed by **one rule** everywhere: `map_tag` → station, else
  `room + zone` → zone, else "not on the map" (§5.1).
- Keyboard and screen-reader complete: every zone and station is a named link;
  the page has the same places as a list (the text alternative).
- Staff can fix a tool's place without a developer (phase 3, §6.5).

### Non-goals (this iteration)

- Furniture, machine footprints, walking directions or "you are here" —
  a schematic says *where*; the tool photo says *what*.
- Live occupancy or unit status on the map (the tool page and units table own
  that).
- Multiple floors in the UI. The model allows several plans (§4.4); there is
  one today and a switcher is not built until there is a second.
- Pan and zoom. The plan fits the column at every width; at 390px the station
  tags are small but the list below carries every name.
- Uploading an arbitrary floor plan and having regions detected from it.
  Tracing is a person's job (§4.2).

## 3. Architecture

- **No new capability.** `get_tool_details` (catalog capability) gains a
  `map` field (§5.4); the prompt fragment gains one paragraph. Both surfaces
  (chat and MCP) get it, since the field is part of the read.
- **Pure core** `src/lib/map/`: `types.ts` (the plan's shape), `studio-101.ts`
  (the traced plan), `placement.ts` (the one placement rule, highlight
  resolution, density steps), `locate.ts` (`locateTool`, `mapFactsFor`). No
  directives, no `server-only`, so server components, the client explorer,
  capability code and tests share it.
- **Components** `src/components/map/`: `FloorMap` (inline SVG, no state,
  renders on server or client), `ToolLocationMap` (the tool-page section,
  server), `MapExplorer` (the `/map` island). Styles in
  `src/styles/floor-map.css`, tokens only.
- **Route** `src/app/map/page.tsx`: reads the cached catalogue
  (`getCatalogTools`) inside a Suspense boundary; the explorer reads
  `?highlight=`/`?q=` with `useSearchParams` inside it, so the shell stays
  static under `cacheComponents`.
- **Notion:** nothing. `map_tag` already mirrors as "Map tag". If phase 2's
  `locations.station` column lands, the mirror's locations schema gains it.

## 4. Data model

### 4.1 What exists

`locations`: `room` and `zone` not null, `map_tag` null and unique, unique on
`(lower(room), lower(zone))` (data platform spec §4.3). `tools.location_id` →
`locations`. `MakerLabTool.mapId` carries `map_tag` to the UI.

Live (local import, 100 tools, read through the public MCP on 2026-09-25):

| Room / zone | Tools |
|---|---|
| Studio 101 / Common Purpose Space | 12 |
| Studio 101 / 3D Printing Hub | 12 |
| Studio 101A / Machining Shop | 57 |
| Studio 101C / Laser Machine Room | 2 |
| Studio 101D / Electronics Lab | 8 |
| Unknown / Unknown | 9 |

So **every location today is a zone**, all five match the plan by name, and
no live location carries a station tag the plan uses. In v4's data exactly one
tool had a tag (`1C`, on the heat press); the old `ML-RESIN-01` /
`ML-LSR-400` values are demo-seed and fixture inventions, not the lab's.

### 4.2 The plan asset

A plan is a `FloorPlan` (`src/lib/map/types.ts`):

```ts
interface FloorPlan {
  id: string;            // "studio-101"
  version: string;       // "2026-07-24.1" — source date + trace revision
  title: string;         // "Studio 101, TATA Innovation Center"
  source: string;        // said on the page
  placeholder: boolean;  // true ⇒ the page says "placeholder layout"
  viewBox: { x; y; w; h };
  outline: MapPoint[];                // building outline
  walls: [MapPoint, MapPoint][];      // interior walls
  zones: MapZone[];      // { id "Z1", number "1", room, zone, polygon, labelAt }
  stations: MapStation[];// { id "1C" (= map_tag), label, zoneId, marks[] }
}
```

**Data, not an SVG file.** The drawing is generated from this structure, not
stored as markup, because (a) the regions must be real links with translated
names, (b) the same data draws a 320px thumbnail and the full map, (c) a test
can assert every station's zone exists and every zone name matches the
database, and (d) there is no SVG sanitisation problem. Coordinates are the
source plan's own (scaled to 2000px wide), so a trace can be checked against
the photo by eye.

**Tracing pipeline** (a person, once per plan revision): open the source at
2000px, click the outline, walls, zone polygons and each station's label
centre, write them into the plan module, bump `version`. The spike's trace
took one pass from the JPEG; the source is clean enough that no redraw of
furniture is needed.

### 4.3 Where the plan lives

- **Phase 1:** in the repository (`src/lib/map/studio-101.ts`), versioned by
  git. The source JPEG is **not** committed (3.9 MB, and it may be the
  facilities team's document — open question 1).
- **Phase 3 (if wanted):** a `floor_plans` table — `id`, `slug`, `title`,
  `version`, `definition jsonb` (the `FloorPlan` above, zod-validated),
  `source_attachment_id` (the original photo/PDF in Blob, private),
  `published`, actor columns and timestamps — edited on `/admin/map` by
  pasting or uploading a definition. Worth it only if the layout changes more
  than once a year; otherwise a PR is the right review.

### 4.4 Floors and rooms

`FLOOR_PLANS` is a list; placement tries each plan in order and the first
that places a tool wins. A second floor (or the "Bloomberg 061" room that
appears only in test fixtures) is a second plan and, at that point, a plan
switcher on `/map` (`?plan=`). Nothing in the model assumes one.

### 4.5 Stations: migration (phase 2)

A tool at a station needs a location row whose `map_tag` is the station code,
and the unique `(room, zone)` stops two rows in one zone. Proposed migration:

```sql
ALTER TABLE locations DROP CONSTRAINT locations_room_zone_key;
CREATE UNIQUE INDEX locations_room_zone_tag_key
  ON locations (lower(room), lower(zone), lower(coalesce(map_tag, '')));
```

A location is then **a zone** (`map_tag` null) **or a station in a zone**
(`Studio 101C / Laser Machine Room / 4A`). `zone` keeps meaning the zone, so
every existing surface that prints "room / zone" stays right, and the station
label comes from the plan. Existing rows are untouched (all are zones). The
import's duplicate-tag rule (`run.ts`) is unchanged. *The spike did not run
this migration*: its scratch data put station tools on locations whose `zone`
is the station name, which the placement rule tolerates because the tag wins.

## 5. Behavior / flow

### 5.1 Placement (one rule)

`placeTool(index, { mapId, location, zone })`:

1. `mapId` (the tag) names a station on the plan → that station and its zone.
2. else `room + zone`, case- and whitespace-insensitive → that zone.
3. else **not on the map**. `Unknown / Unknown` lands here, as do tags the
   plan does not have (after trying 2).

### 5.2 Tool page

Below the hero, above Safety: **WHERE IT IS** — the thumbnail (`role="img"`,
named by a sentence), then `ZONE 4 · LASER MACHINE ROOM`, `STUDIO 101C`,
`Station 4A · Trotec Laser Machine` when there is one, and **Open map** →
`/map?highlight=4A`. Not on the map: "This tool's location (Unknown / Unknown)
is not on the floor map yet." and **Open map** → `/map`. The thumbnail draws
only the tool's own station tag, at double size.

### 5.3 `/map`

- Header: `// MAP` · FLOOR MAP · lede · facts (`5 ZONES · 17 STATIONS · 93
  TOOLS ON THE MAP · 7 NOT ON THE MAP`); a mono line naming the source and
  version, and **"Placeholder layout — not the lab's real floor plan"** in warn
  ink whenever `plan.placeholder`.
- Search (fuzzy, the gallery's `match-sorter` over name, official name,
  category, tags, materials) lights matching zones and stations with an
  accent-ink rule; a live status line says how many match and how many of
  those are not on the map.
- Zones are shaded in four ink steps by quartile of the busiest zone, with the
  count printed ("57 TOOLS"). The accent is only for the highlighted place.
- Clicking a zone or station (or its entry in **Places**) highlights it and
  opens its tools in the gallery's `GalleryTable`, narrowed by the search;
  clicking again or **Show the whole map** clears it. **Not on the map** is a
  place too (`?highlight=unplaced`), so the unplaced tools are one click away,
  never hidden.
- State is in the URL, written with `replaceState`. An unknown
  `?highlight=` says it is not a place on this map and highlights nothing.

### 5.4 Assistant

`get_tool_details` returns

```ts
map: {
  zone: "Laser Machine Room", zone_number: "4", room: "Studio 101C",
  station: "4A" | null, station_label: "Trotec Laser Machine" | null,
  map_page: "/map?highlight=4A",
} | null
```

and the prompt says: for "where is …", answer from `map` (zone with number,
room, station), link `[See it on the floor map](/map?highlight=…)`; if `map`
is null, say it is not on the map and give the catalogue's location — never
guess. The chat already opens internal links in place. No new tool, no
`chatOnly`. Not evaluated against the §10 eval harness in the spike; phase 1
adds two eval cases ("where is the Trotec", "where is the Brother printer").

### 5.5 Unhappy paths

- Catalogue unreachable: `/map` renders the gallery's failure path (the same
  cached read); the plan still draws, with no counts.
- A plan zone that no location names: drawn, count 0 ("EMPTY"), still a link.
- A location naming a zone the plan lacks: its tools are "not on the map".
- A station tag used by two locations: impossible (`map_tag` unique).

## 6. UI

### 6.1 `FloorMap`

Inline SVG, `viewBox` from the plan, `width: 100%`. Page paper
(`--surface-container`), 1px dot grid at 32 units, walls 4–6 units in ink,
zone borders dashed hairlines, station tags as the plan's black labels
(inverted in dark mode by the tokens), mono type throughout, no radius, no
shadow, 150ms linear fill transitions off under reduced motion.
`mode="full"` makes zones and stations `<a href>` inside the SVG (works with
no JS; `onSelect` takes the click in the explorer). `mode="thumbnail"` is one
image with nothing focusable.

### 6.2 States

Loading: nothing (the page is fast; the catalogue read is cached). Empty zone:
"EMPTY". Error: see §5.5. Search with no matches: the status line says so.

### 6.3 Mobile

At 390px the map is full-width above the Places list; the side panel stacks
below; the table becomes its two-line list. No horizontal scroll at 390 or
1440 (checked in the spike's screenshots, light and dark).

### 6.4 Navigation

`MAP` joins the public bar between TOOLS and PROJECTS (open question 3 — the
bar's contents are an owner decision of 2026-09-23).

### 6.5 Admin linking (phase 3)

The tool editor's location field is today a choice of `locations` rows. It
gains a **place picker**: the full `FloorMap` in the editor sheet; clicking a
zone or station chooses (or `findOrCreateLocation`s) the matching location —
zone rows by room + zone, station rows by tag — and the field shows
`Zone 4 · Laser Machine Room · 4A` in words. Behind `tools.edit`, through the
editor's existing server actions and revision token. `/admin/inventory`
gains a **Not on the map** facet (tools whose location places nowhere), so the
nine `Unknown` tools become a queue.

### 6.6 Strings

New `map.*` namespace and `nav.map` in `en.json` (ICU plurals for counts);
the other 11 locales fall back to English until translated (Article 6 as
amended). Zone and station names are **data** from the plan, shown as the lab
prints them, not translated.

## 7. Relationship to existing work

- Builds on data platform spec §4.3 (`locations`, `map_tag`) and the UI system
  (`PageHeader`, `EmptyState`, `Input`, `Button`, `GalleryTable`/`DataTable`).
- `docs/v5-plan.md` §9 lists a "lab-map view — 2D floor plan first, with tools
  placed by `Location.id`"; this is that.
- QR codes spec: printed labels could carry the station code next to the QR.
- The demo seed's `ML-RESIN-01` / `ML-LSR-400` tags should become plan
  stations (`2B`, `4A`) in phase 1 so the E2E exercises station highlighting.

## 8. Security and safety

- **Authorization:** `/map` and the tool-page section are public, like the
  gallery; they show only published tools (the cached catalogue read). The
  place picker is `tools.edit`.
- **Rate limiting:** no new API route. The page reads the cached catalogue.
- **Untrusted input:** `?highlight=` and `?q=` are matched against in-memory
  data only, never rendered as HTML. The plan is code (phase 1) or a
  zod-validated JSON definition (phase 3) — never uploaded SVG markup, so no
  script-in-SVG surface.
- **Prompt injection:** `map` fields come from the plan and the locations
  table, not from the web.
- **PII:** none.
- **Facilities:** a building layout is public-facing. The plan shows rooms and
  zones only, no doors or exits beyond the outline — but open question 1 asks
  whether the lab may publish it at all.

## 9. Phased build order

1. **Map read-only** — `src/lib/map/*`, `FloorMap`, tool-page section, `/map`,
   nav link, `get_tool_details.map` + prompt, `en.json`, unit/component tests,
   an E2E (`/map?highlight=Z4` shows the Trotec; the tool page links there),
   demo seed moved onto plan tags. Mergeable alone; zone-level placement works
   on today's data.
2. **Stations** — the §4.5 migration, the import and mirror carrying it, the
   editor's location field able to name a station. Parallel to 3.
3. **Admin linking** — the place picker (§6.5) and the inventory facet;
   optionally `floor_plans` + `/admin/map` (§4.3) if the layout changes often.
4. **Translations** of `map.*` into the 11 locales.

## 10. Testing

- **Unit** (`placement.test.ts`, in the spike): tag → station → zone; room +
  zone ignoring case/space; unknown tag falls back; `Unknown/Unknown` is
  unplaced; every zone has an entry; highlight resolution; density quartiles;
  the traced plan's station ids unique and zones named as the live table
  names them; `mapFactsFor` shape.
- **Component** (`FloorMap.test.tsx`, in the spike): full mode — every zone and
  station is a named link to its `/map` view, `onSelect` takes the click;
  thumbnail — one named image, no links, only the "here" station.
- **Integration (phase 1):** `get_tool_details` returns `map` for a placed
  tool and `null` for an unplaced one; the prompt fragment contains the
  paragraph.
- **E2E (phase 1):** `/map` keyboard path (Tab to zone 4, Enter, table lists
  the Trotec, URL is `?highlight=Z4`); tool page → Open map.
- **Embarrassing in production:** a tool shown in the wrong room because a
  name almost matched (the rule is exact after normalisation — test it); the
  assistant inventing a zone for an `Unknown` tool (eval case); the thumbnail
  unreadable in dark mode (screenshots).

## 11. Open questions (owner)

1. **May the lab's zone plan be published** on a public page, traced as a
   schematic? Who owns the drawing (facilities, the lab)? Should the source
   JPEG be committed or stay out of the repo?
2. **Is the 2026-07-24 plan current?** `1G` (3D Scanning & VR) is printed
   twice; the corridor with `1H` and the space below the Electronics Lab are
   unlabeled — are they part of zone 1 / zone 5, or not lab space?
3. **MAP in the top bar?** The bar's contents were fixed on 2026-09-23
   (`TOOLS · PROJECTS · ABOUT · REPORT`); the spike adds MAP and updates that
   test. Alternative: no bar item, reached from tool pages and the gallery.
4. **Stations:** do you want tools placed at station level (§4.5 migration,
   then someone assigns the ~20 station tools), or is zone-level enough? The
   plan's legend suggests the assignments (Trotec → 4A, Epilog → 4B, ShopBot →
   3A, Wazer → 3B, FDM → 2A, SLA → 2B, vinyl cutters → 1C); v4 had `1C` on the
   heat press, which may be right (same station) or a mistake.
5. **The nine "Unknown / Unknown" tools** (e.g. the Roland vinyl cutter, the
   Cricut, a DeWalt drill, the Brother printer): who places them? Phase 3's
   facet makes it a queue.
6. **Room letters:** the data has Studio 101, 101A, 101C, 101D. Is there a
   101B, and where?
7. **Other spaces:** "Bloomberg 061" appears only in test fixtures. Does the
   lab have equipment anywhere other than Studio 101? If so, send its plan as
   a PDF or photo and it becomes a second `FloorPlan`.
