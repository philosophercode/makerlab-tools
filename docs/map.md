# Your lab's floor map

> The floor map (`/map`, and the "Where is it?" thumbnail on every tool page) draws the
> lab's plan as an SVG and lights up where each tool is. The assistant uses the same data
> to answer "where is the laser cutter?". Design: [floor map spec](specs/2026-09-25-floor-map-design.md).

**There is no upload button.** A plan is a small TypeScript file of coordinates traced
from a floor plan image, checked by the type system and the tests. A fork replaces the
Cornell plan with its own in four steps. An AI model does the tracing; the prompt is
below.

## How a tool lands on the map

A plan has two levels:

- **Zones**: numbered areas ("4 · Laser Machine Room"). A tool is placed in a zone when its
  location's **room and zone** match the zone's `room` and `zone`, ignoring case and
  spaces.
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

Give a vision-capable model (Claude, ChatGPT, Gemini) the image, the file
[`src/lib/map/types.ts`](../src/lib/map/types.ts), the example
[`src/lib/map/studio-101.ts`](../src/lib/map/studio-101.ts), and this prompt:

````text
Trace the attached floor plan into a TypeScript file for MakerLAB Tools.

Output one file, `src/lib/map/<plan-id>.ts`, in exactly the shape of the attached
`studio-101.ts`: `import "server-only";`, `import type { FloorPlan } from "./types";`,
one exported `const` of type `FloorPlan`, and `export const FLOOR_PLANS = [<that const>];`.
Follow `types.ts` exactly; add no fields.

Coordinates:
- Scale the image so it is 2000 units wide; use those units for every point, so a
  point can be checked against the image by eye. Round to whole numbers.
- `viewBox` frames the outline with about 30 units of margin.
- `outline` is the building's outer boundary, clockwise, as few points as keep its shape.
- `walls` are interior walls as [start, end] segments. Doors can be ignored.

Zones (one per numbered area):
- `id` "Z1", "Z2", … ; `number` is the number printed on the plan.
- `room` and `zone` are the room name and the area name. Use these exact strings,
  which must match what the lab's inventory uses: <PASTE YOUR ROOM / ZONE NAMES>.
- `polygon` follows the area's edges, clockwise, never crossing another zone.
- `labelAt` is a point well inside the polygon.

Stations (one per lettered label):
- `id` is the label exactly as printed ("1A", "4B"); it is the join key to the
  inventory's map tags.
- `label` is the legend's words for it; `zoneId` is the zone it sits in.
- `marks` is where the label is printed; a station shown twice has two marks.

Metadata: `id` "<plan-id>", `version` "<today's date>.1", `title` "<room, building>",
`source` "Traced from <the image's name and date>", `placeholder: false`.

Draw no furniture or machines. If anything on the plan is unclear, list it as
comments at the top of the file rather than guessing.
````

## 3 · Put it in the app

1. Save the file as `src/lib/map/<plan-id>.ts`.
2. Point the three imports at it: `src/lib/map/locate.ts` (`FLOOR_PLANS`),
   `src/components/map/MapGate.tsx` and `src/components/map/SignedInProjectWorkMap.tsx`
   (the plan constant).
3. Update the plan's tests (`src/lib/map/placement.test.ts` checks the zone names;
   `FloorMap`, `MapExplorer`, `MapGate` and `work-plan` tests import the plan), then
   `npm test`.
4. Run `npm run dev`, sign in, open `/map`, and compare it with the image. Fix points by
   hand; they are in the image's own scale.

## 4 · Match the inventory to it

Make each tool's location use a zone's room and zone names (the tool editor's Location
field, or intake). For a station, set its location's map tag to the station's `id`.
Then a tool page shows its thumbnail, `/map?highlight=4A` lights the station, and the
assistant's `get_tool_details` answer carries the zone and station in words.

## Who sees it

`/map` and the tool-page thumbnail are for **signed-in people only**: a plan of the
building is not published to anonymous visitors (`src/lib/map/access.ts`, PR #98).
