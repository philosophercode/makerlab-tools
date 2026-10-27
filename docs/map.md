# Your lab's floor map

> The floor map (`/map`, and the "Where is it?" thumbnail on every tool page) draws the
> lab's plan as an SVG and lights up where each tool is. The assistant uses the same data
> to answer "where is the laser cutter?". Design: [floor map spec](specs/2026-09-25-floor-map-design.md).

**There is no upload button.** A plan is one JSON file, `lab/floor-plan.json`, of
coordinates traced from a floor plan image and checked against a published JSON Schema
(`lab/floor-plan.schema.json`). An AI model does the tracing (the prompt is below), and
`npm run lab:check` names anything wrong with the result. No code changes.

A lab with no plan sets `map: false` in `lab/lab.config.ts`: `/map` answers 404, the nav
and the tool pages' thumbnails go, and the assistant says the lab has no map.

## How a tool lands on the map

A plan has two levels:

- **Zones**: numbered areas ("4 · Laser Machine Room"). A tool is placed in a zone when its
  location's **room and zone** match the zone's `room` and `zone`, ignoring case and
  spaces, or match one of the zone's **`matches`**: other names for it, written
  `"Room"` (every location in that room) or `"Room / Zone"`. `matches` is for an
  inventory that names places differently from the drawing; tried after the exact names.
- **Stations**: lettered spots inside a zone ("4A · Trotec Laser Machine"). A tool is
  placed on a station when its location's **map tag** (`locations.map_tag`) equals the
  station's `id`.

A tool whose location matches neither is "not on the map yet", and the assistant says so
rather than guessing. Locations come from intake (room and zone) or the Notion import
(room, zone and map tag). Picking a place by clicking the map in the tool editor is
specced (phase 3) but not built.

## 1 · Get a plan image

Any floor plan works: an architect's drawing, a fire-escape plan, a photo of a
whiteboard sketch. Mark the zones (numbers) and stations (letters) on it first if they
are not already, with a legend naming each one.

## 2 · Have a model trace it

Give a vision-capable model (Claude, ChatGPT, Gemini) the image, the schema
[`lab/floor-plan.schema.json`](../lab/floor-plan.schema.json), the example
[`lab/floor-plan.json`](../lab/floor-plan.json), and this prompt. Paste the place names
your inventory uses where it says so: `npm run lab:check -- --inventory` lists them.

````text
Trace the attached floor plan into a JSON floor plan for MakerLAB Tools.

Answer with one JSON object and nothing else, valid against the attached JSON Schema
(floor-plan.schema.json), in the shape of the attached example (floor-plan.json). Its
first key is "$schema": "./floor-plan.schema.json". Add no fields the schema lacks.

Coordinates:
- Scale the image so it is 2000 units wide; use those units for every point, so a
  point can be checked against the image by eye. Round to whole numbers. Points are
  [x, y] arrays.
- `viewBox` frames the outline with about 30 units of margin; every point lies inside it.
- `outline` is the building's outer boundary, clockwise, as few points as keep its shape.
- `walls` are interior walls as [start, end] segments. Doors can be ignored.

Zones (one per numbered area):
- `id` "Z1", "Z2", … ; `number` is the number printed on the plan.
- `room` and `zone` are the room name and the area name, in the inventory's words.
  The inventory's places are: <PASTE THE ROOM / ZONE NAMES FROM lab:check --inventory>.
- Where the inventory's names for a zone differ from the plan's, list them in the
  zone's `matches`: "Room" for every place in that room, or "Room / Zone" for one.
  Never list a name under two zones.
- `polygon` follows the area's edges, clockwise, never overlapping another zone
  (zones may share an edge).
- `labelAt` is a point well inside the polygon.

Stations (one per lettered label):
- `id` is the label exactly as printed ("1A", "4B"); it is the join key to the
  inventory's map tags.
- `label` is the legend's words for it; `zoneId` is the zone it sits in.
- `marks` is where the label is printed; a station shown twice has two marks.

Metadata: `id` "<plan-id>", `version` "<today's date>.1", `title` "<room, building>",
`source` "Traced from <the image's name and date>", `placeholder` false.

Draw no furniture or machines. If anything on the plan is unclear, say so after the
JSON object rather than guessing.
````

## 3 · Check it

1. Save the answer as `lab/floor-plan.json` (and `map: true` in `lab/lab.config.ts`).
2. `npm run lab:check`. It fails on what would break the map, one line each with the
   field's path: a station in a zone that does not exist, a zone label outside its zone,
   overlapping zones, a point outside the `viewBox`, a duplicate id or name. It warns,
   without failing, about a station label printed outside its own zone, which a printed
   plan sometimes does on purpose. Fix by hand, or paste the lines back to the model.
3. `npm run lab:map-preview -- --image plan.png --image-width 2000` writes
   `lab/.preview.html` (not committed): the plan drawn over the image at half opacity.
   Open it and compare. `--image-width` is the image's width in the plan's units (2000
   if the model followed the prompt).
4. `npm run dev`, sign in, open `/map`.

## 4 · Match the inventory to it

`npm run lab:check -- --inventory` reads the database (`DATABASE_URL`, else
`PGLITE_DATA_DIR`) and lists every location that lands nowhere on the plan, with the
`matches` line that would place it, and the zones no tool uses. Either add those lines to
the plan, or change the locations (the tool editor's Location field, or intake) to the
zones' names. For a station, set its location's map tag to the station's `id`. Then a
tool page shows its thumbnail, `/map?highlight=4A` lights the station, and the
assistant's `get_tool_details` answer carries the zone and station in words.

After changing `src/lib/map/schema.ts`, run `npm run lab:schema` to regenerate the
published schema; a test fails while it is stale.

## Who sees it

`/map` and the tool-page thumbnail are for **signed-in people only**: a plan of the
building is not published to anonymous visitors (`src/lib/map/access.ts`, PR #98).
