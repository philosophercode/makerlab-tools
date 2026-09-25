import type { FloorPlan } from "./types";

/**
 * Studio 101, TATA Innovation Center — traced from the lab's own zone plan
 * ("Latest MakerLAB zone plan.jpg", 4289×3102, 2026-07-24; floor map spec
 * §4.2). Coordinates are those of the plan scaled to 2000px wide, so a point
 * can be checked against the source by eye.
 *
 * What was traced: the building outline, the interior walls, the five zones
 * and the seventeen station labels at the positions the plan prints them. What
 * was not: furniture and machines — a schematic says *where*, and the photo
 * on the tool page says *what*.
 *
 * Zone names are the legend's, which are also the names the Notion import
 * wrote to `locations.zone`; the rooms (`Studio 101`, `101A`, `101C`, `101D`)
 * are the ones the live `locations.room` column holds. Where the plan and
 * the data could disagree is listed in the spec's open questions.
 *
 * A station's `id` is the label printed on the plan, which is what
 * `locations.map_tag` is for.
 */
export const STUDIO_101: FloorPlan = {
  id: "studio-101",
  version: "2026-07-24.1",
  title: "Studio 101, TATA Innovation Center",
  source: "Traced from the MakerLAB zone plan of 2026-07-24",
  placeholder: false,
  viewBox: { x: 100, y: 70, w: 1130, h: 1140 },
  outline: [
    [495, 100],
    [1200, 100],
    [1185, 1180],
    [125, 1030],
  ],
  walls: [
    // The spine between the open studio and the east rooms.
    [
      [945, 100],
      [945, 1146],
    ],
    // Machining Shop's south wall.
    [
      [945, 525],
      [1197, 525],
    ],
    // The stair, and the Laser Machine Room's north walls around it.
    [
      [1035, 610],
      [1193, 610],
    ],
    [
      [1035, 610],
      [1035, 710],
    ],
    [
      [945, 710],
      [1035, 710],
    ],
    // Laser Machine Room / Electronics Lab.
    [
      [945, 888],
      [1191, 888],
    ],
    // Electronics Lab's south wall.
    [
      [945, 1020],
      [1189, 1020],
    ],
  ],
  zones: [
    {
      id: "Z1",
      number: "1",
      room: "Studio 101",
      zone: "Common Purpose Space",
      polygon: [
        [495, 100],
        [945, 100],
        [945, 865],
        [515, 865],
        [515, 1085],
        [125, 1030],
      ],
      labelAt: [495, 617],
    },
    {
      id: "Z2",
      number: "2",
      room: "Studio 101",
      zone: "3D Printing Hub",
      polygon: [
        [515, 865],
        [945, 865],
        [945, 1146],
        [515, 1085],
      ],
      labelAt: [760, 975],
    },
    {
      id: "Z3",
      number: "3",
      room: "Studio 101A",
      zone: "Machining Shop",
      polygon: [
        [945, 100],
        [1200, 100],
        [1197, 525],
        [945, 525],
      ],
      labelAt: [1072, 330],
    },
    {
      id: "Z4",
      number: "4",
      room: "Studio 101C",
      zone: "Laser Machine Room",
      polygon: [
        [1035, 610],
        [1193, 610],
        [1191, 888],
        [945, 888],
        [945, 710],
        [1035, 710],
      ],
      labelAt: [1030, 790],
    },
    {
      id: "Z5",
      number: "5",
      room: "Studio 101D",
      zone: "Electronics Lab",
      polygon: [
        [945, 888],
        [1191, 888],
        [1189, 1020],
        [945, 1020],
      ],
      labelAt: [1030, 955],
    },
  ],
  stations: [
    { id: "1A", label: "Lounge", zoneId: "Z1", marks: [[293, 948]] },
    { id: "1B", label: "Office Hour Desk", zoneId: "Z1", marks: [[478, 893]] },
    { id: "1C", label: "Vinyl Cutting Station", zoneId: "Z1", marks: [[353, 688]] },
    { id: "1D", label: "Paper Prototyping Cart", zoneId: "Z1", marks: [[413, 546]] },
    { id: "1E", label: "FirstAid | PPE | INFO Column", zoneId: "Z1", marks: [[556, 482]] },
    { id: "1F", label: "Sewing Station", zoneId: "Z1", marks: [[507, 343]] },
    {
      id: "1G",
      label: "3D Scanning & VR Station",
      zoneId: "Z1",
      marks: [
        [734, 215],
        [774, 392],
      ],
    },
    { id: "1H", label: "Sink | Waste Disposal | Books", zoneId: "Z1", marks: [[985, 600]] },
    { id: "1J", label: "Work Tables | Teaching Space", zoneId: "Z1", marks: [[675, 646]] },
    { id: "1K", label: "Wood Working Hand Tools & Hardware", zoneId: "Z1", marks: [[890, 447]] },
    { id: "2A", label: "FDM 3d Printers", zoneId: "Z2", marks: [[605, 882]] },
    { id: "2B", label: "SLA 3d Printers", zoneId: "Z2", marks: [[711, 1052]] },
    { id: "3A", label: "Shopbot CNC", zoneId: "Z3", marks: [[1080, 192]] },
    { id: "3B", label: "Wazer Waterjet", zoneId: "Z3", marks: [[985, 466]] },
    { id: "3C", label: "Power & Hand Tools", zoneId: "Z3", marks: [[1147, 415]] },
    { id: "4A", label: "Trotec Laser Machine", zoneId: "Z4", marks: [[1130, 688]] },
    { id: "4B", label: "Epilog Laser Machine", zoneId: "Z4", marks: [[1130, 843]] },
  ],
};

/** Every plan the app knows, first is the default. One floor today (spec §4.4). */
export const FLOOR_PLANS: readonly FloorPlan[] = [STUDIO_101];
