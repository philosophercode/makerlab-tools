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

## Amendment — The map above the fold (2026-10-07)

The owner: on `/map` at 1440 × 900 the header, the facts, the source line,
the search and the zone chips pushed the map down — its top at y = 490, half
of it below the fold. The map now starts in the first screen and, on a
laptop, all of it is visible.

- **A compact header:** breadcrumb, title and facts only (`PageHeader`, no
  bottom padding). The lede moved beside the map as the search's hint; the
  source line ("Traced from the MakerLAB zone plan …") moved under the map.
  The placeholder warning, when a plan is one, stays above it.
- **From lg** (`.map-layout`, `floor-map.css`): the map takes the left column,
  sized to the window's height — `(100svh − sticky chrome − 136px) × the
  plan's aspect`, at least 360px and at most 60% of the row (176px on a demo
  deployment, for the demo-data banner) — and sticks under the chrome while
  the places scroll. The hint, search, zone bar, the picked place's panel and
  the Places list sit beside it, in that order.
- **On a phone:** one column in reading order — hint, search, zone bar (one
  sideways-scrolling row), map, then the places. Below lg the map is never
  taller than the window (a tablet, a phone on its side).
- **Measured** (local database, signed in): the map's top edge at 1440 × 900
  moved from y = 490 (52% visible) to y = 244 (100%, 633px tall); at
  1280 × 800 from 482 (46%) to 236 (100%); at 390 × 844 from 548 (82%) to
  456 (100%).
- Every function stays: the search and its live count, the zone bar, the
  place panel, the Places list, Escape and Back. **Tested** in
  `e2e/map.spec.ts` (the map's position at 1440 × 900, 1280 × 800 and
  390 × 844) and the existing `MapExplorer.test.tsx`.

## Amendment — Places first, the map on top (2026-10-27)

**Status:** Draft, for the owner's review. **Spec PR:** this one. **Implementation PR:**
opens after it merges (Article 1).

The owner (2026-10-27), after standing up a second deployment with its own inventory:
the map, the tools and the units are coupled too tightly. A lab with a different layout,
or with no traced plan yet, gets a `/map` where every tool is "Not on the map" and the
Places list names rooms it does not have. This amendment makes **places a database
fact** and the **drawing an optional layer** over them.

### A.1 What is coupled today

- `tools.location_id` → one `locations` row (`room`, `zone`, `map_tag`). Units have no
  place of their own.
- `placeTool` (§5.1) joins a location to the plan by **text**: `map_tag` equal to a
  station id, else `room + zone` equal to a zone's names.
- The **Places** list on `/map` is built from the plan's zones and stations, not from
  `locations`. A location the plan does not draw has no entry; its tools fall into
  **Not on the map**.
- Renaming a zone in the plan, or importing a list whose locations are spelled
  differently ("Wood Shop" against "Machining Shop"), unplaces tools silently.
- Approving an imported item matches its location hint against **existing** locations
  only (`matchLocation` in `src/lib/intake/approval-draft.ts`). On an empty database
  nothing matches, so imported tools are approved with no location and the hint is lost.

### A.2 The model

Three layers, each usable without the one above it:

1. **Places** (`locations`): where things are, in the lab's own words. Always present.
2. **Links**: a place may name **one** zone or station of the current plan
   (`locations.map_place`). Optional.
3. **The drawing** (`FloorPlan`, from `lab/floor-plan.json` under the lab-config spec, or
   `map: null`). Optional.

`map_tag` stays the **printed label** (QR sheets, the Notion import, the legend). It is
no longer the join key.

### A.3 Data model

Migration (next free number, e.g. `0035_places_first.sql`):

```sql
ALTER TABLE locations ADD COLUMN map_place text;          -- a zone id (Z4) or station id (4A) on the current plan
ALTER TABLE units ADD COLUMN location_id uuid REFERENCES locations(id) ON DELETE SET NULL;
CREATE INDEX units_location_idx ON units (location_id);
```

- `map_place` is **not** a foreign key: the plan is a file, not a table. `npm run
  lab:check -- --inventory` (lab-config §5.2) reports every `map_place` the plan does
  not have, and those places render as "not drawn" (A.4), never as an error.
- `units.location_id` null means "where its tool is". Set only when one unit lives
  elsewhere (a printer in another room).
- **Backfill** (`npm run map:link`, dry run by default, `--write` to apply): for every
  location with `map_place` null, take the station its `map_tag` names, else the zone
  its `room + zone` names. That reproduces today's placement exactly, so the backfill
  is behavior-preserving. It is a script, not SQL, because the plan is not in the
  database. It runs once per deployment and again after a new plan.

### A.4 Placement (replaces §5.1)

`placeThing({ unitLocation, toolLocation })`:

1. The unit's location if it has one, else the tool's location. None → **No place**.
2. That location's `map_place` names a station or zone on the plan → there.
3. Otherwise the place is **not drawn**. It is still a place: listed under its room with
   its tools, just not lit on the drawing.

No name matching remains. A location's room and zone are free text again, so an import
in any lab's vocabulary keeps its places.

### A.5 `/map` and the Places list

- **Places come from `locations`**, grouped by room, each with its tool count. Places
  linked to the plan show the zone or station badge (`4A`) and highlight it; places not
  drawn say so in words.
- **No place** replaces **Not on the map** for tools with no location at all. Places not
  drawn are listed under their rooms, not in a bucket.
- **With `map: null`**, `/map` still answers: the Places list without a drawing. This
  supersedes lab-config §5.5's "`/map` answers 404" for that case. Nav keeps the item
  (renamed **Places** only if the owner wants, A.10).
- Counts are **tools**, as now. A tool whose units sit in two places appears in both,
  with "2 of 4 units here".
- `get_tool_details.map` keeps its shape. It gains `place: { room, zone }` from the
  database whether or not the place is drawn, so the assistant can say "in the Wood
  Shop" for a lab with no plan.

### A.6 Admin: places

`/admin/inventory/locations` (behind `tools.edit`), the §6.5 picker made concrete:

- A table of places: room, zone, map label, link, tool count. Add, rename, merge two
  places (moves their tools and units, then deletes one), delete an empty place.
- **Link to the map**: the full `FloorMap` in a sheet. Clicking a zone or station sets
  `map_place`. **Unlink** clears it. With `map: null` the column is hidden.
- The tool editor's location field and a new unit location field pick from these
  places, with "Add a place" inline.
- New action ids `locations.create`, `locations.update`, `locations.merge`,
  `locations.delete`, `locations.link` in `src/lib/actions/`, so the assistant can
  propose them (Assistant–GUI parity), each confirmed on a card.

### A.7 Intake

Approving an imported or chat-added item whose location hint matches no place
**creates** the place (`findOrCreateLocation`) instead of dropping the hint. A hint
`"Room / Zone"` splits on the slash; a one-part hint becomes the zone, in the room the
lab config names as its default (`identity.room`, falling back to the hint itself; see
A.10, question 1). The approval sheet shows "New place: Wood Shop" so the reviewer can
pick an existing one instead.

### A.8 Security

- Visibility is unchanged: the drawing stays signed-in only (§8, `src/lib/map/access.ts`).
  The Places list follows the same rule, because a place list is the plan in words.
- Place names reach the assistant through `get_tool_details`, already public for tools.
- Merge and delete are staff actions with revision tokens, logged like other inventory
  edits.

### A.9 Build order

1. Migration, `map:link` backfill, `placeThing`, Places from `locations` on `/map` and
   the tool page, `map: null` keeps `/map`. Behavior-preserving after the backfill.
2. `/admin/inventory/locations`: list, add, rename, merge, delete, link picker; the five
   actions.
3. Unit locations: the field, the per-unit placement, "2 of 4 units here".
4. Intake creates unmatched places (A.7).

Lab-config phase 2 (the plan as `lab/floor-plan.json`) is independent of this and can
land before or after. Whichever lands second updates `lab:check --inventory` to read
`map_place`.

### A.10 Open questions (owner)

1. A one-part location hint ("Wood Shop"): store it as the **zone** inside a default
   room, or as both room and zone?
2. Rename the nav item **MAP** to **PLACES** when a lab has no drawing?
3. Should units be counted on the map (a zone with 6 printers reads "6") rather than
   tools ("1 tool")?

### A.11 Testing

- `placement.test.ts`: unit override, tool location, linked station, linked zone, not
  drawn, no place; a renamed zone keeps its tools.
- `map:link`: on a fixture inventory, the backfill reproduces the old `placeTool`
  output for every tool, including the `Unknown / Unknown` ones.
- `MapExplorer.test.tsx`: places not on the plan listed under their room; `map: null`
  renders the list with no drawing.
- Locations admin: merge moves tools and units; delete refuses a place in use; link
  writes `map_place`; every action refused without `tools.edit` and in read-only demo
  mode (`DEMO_ADMIN=view`).
- Intake: an unmatched hint creates one place, and a second item with the same hint
  reuses it.
- `e2e/map.spec.ts`: a database place that is not drawn shows in the Places list.
