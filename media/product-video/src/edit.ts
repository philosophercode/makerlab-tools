import type { Box } from "./timeline";

/**
 * The edit decision list. Every number here is in SOURCE seconds of a clip
 * (public/footage/<clip>.mp4, its timeline in <clip>.json) unless it says
 * otherwise. Re-record a clip and these are the numbers to revisit:
 * `npm run timelines` prints each clip's clicks and marks.
 */

export type Device = "desktop" | "phone" | "tv";

/** Play source [from, to) at `rate`× speed. */
export type Segment = { from: number; to: number; rate: number };

/**
 * From source time `at`, glide over `dur` seconds to scale `s` centred on
 * clip point (x, y) in the page's CSS pixels. `s: 1` is the full frame.
 */
export type CameraMove = { at: number; s: number; x?: number; y?: number; dur?: number };

/** An orange focus ring around a box (a mark from the timeline, or literal). */
export type Highlight = { from: number; to: number; mark?: string; box?: Box; pad?: number };

export type Shot = {
  clip: string;
  device: Device;
  /** The address bar's path; the domain is the deployed one. */
  path?: string;
  segments: Segment[];
  camera: CameraMove[];
  highlights?: Highlight[];
  cursor?: boolean;
  /** A pill over the frame from the shot's start, e.g. a time skip. */
  badge?: string;
};

export type Scene = {
  id: string;
  /** Mono kicker, top-left: "// OPERATE". */
  label: string;
  /** 16:9 only, beside a phone: a short headline. */
  headline?: string;
  shots: Shot[];
};

export const SCENES: Scene[] = [
  {
    id: "hook",
    label: "QR labels",
    shots: [
      {
        clip: "hook-qr",
        device: "desktop",
        path: "/admin/inventory/qr",
        segments: [{ from: 0.9, to: 6.9, rate: 1.2 }],
        cursor: true,
        camera: [
          { at: 0, s: 1.55, x: 760, y: 640, dur: 0 },
          { at: 2.25, s: 2.3, x: 1150, y: 600, dur: 1.1 },
          { at: 4.0, s: 2.65, x: 1218, y: 575, dur: 2.8 },
        ],
        highlights: [{ from: 3.4, to: 7, mark: "label", pad: 8 }],
      },
    ],
  },
  {
    id: "operate",
    label: "Operate",
    headline: "Scan it.\nAsk it.\nCheck the page.",
    shots: [
      {
        clip: "phone-ask",
        device: "phone",
        path: "/tools/bambu-lab-x1-carbon-combo-3d-printer?src=qr",
        segments: [
          { from: 0.4, to: 2.9, rate: 1 },
          { from: 3.7, to: 6.9, rate: 2 },
          { from: 6.9, to: 15.1, rate: 4.5 },
          { from: 15.1, to: 17.6, rate: 1 },
          { from: 18.0, to: 20.2, rate: 1.25 },
        ],
        cursor: true,
        camera: [
          { at: 0, s: 1.45, x: 196, y: 282, dur: 0 },
          { at: 2.2, s: 1, dur: 0.6 },
          { at: 15.15, s: 2.3, x: 170, y: 262, dur: 0.7 },
          { at: 18.0, s: 1.9, x: 175, y: 360, dur: 0.6 },
        ],
        highlights: [
          { from: 0.4, to: 2.5, mark: "arrival", pad: 4 },
          { from: 15.4, to: 17.6, mark: "citation", pad: 5 },
          { from: 18.6, to: 20.2, box: { x: 18, y: 362, width: 356, height: 64 }, pad: 2 },
        ],
      },
    ],
  },
  {
    id: "debug",
    label: "Fix",
    headline: "Report it\nin a sentence.",
    shots: [
      {
        clip: "phone-report",
        device: "phone",
        path: "/tools/bambu-lab-x1-carbon-combo-3d-printer?src=qr",
        segments: [
          { from: 0.7, to: 6.6, rate: 3.5 },
          { from: 6.6, to: 29.9, rate: 12 },
          { from: 29.9, to: 31.5, rate: 1 },
        ],
        cursor: true,
        camera: [
          { at: 0, s: 1.25, x: 196, y: 700, dur: 0 },
          { at: 6.6, s: 1, dur: 0.5 },
          { at: 29.95, s: 1.9, x: 196, y: 592, dur: 0.6 },
        ],
        highlights: [{ from: 30.1, to: 32, mark: "ticket", pad: 6 }],
      },
      {
        clip: "staff-queue",
        device: "desktop",
        path: "/admin/maintenance",
        segments: [{ from: 1.7, to: 5.9, rate: 1.4 }],
        cursor: true,
        camera: [
          { at: 0, s: 1.6, x: 600, y: 420, dur: 0 },
          { at: 4.2, s: 1.75, x: 560, y: 600, dur: 0.6 },
        ],
        highlights: [{ from: 4.5, to: 5.5, box: { x: 56, y: 524, width: 1352, height: 180 }, pad: 4 }],
      },
    ],
  },
  {
    id: "create",
    label: "Build",
    shots: [
      {
        clip: "plan",
        device: "desktop",
        path: "/",
        segments: [
          { from: 1.6, to: 4.3, rate: 1.35 },
          { from: 4.3, to: 8.3, rate: 2.2 },
          { from: 8.3, to: 22.35, rate: 4 },
          { from: 22.35, to: 25.0, rate: 1 },
        ],
        cursor: true,
        camera: [
          { at: 0, s: 1, dur: 0 },
          { at: 3.9, s: 1.75, x: 1180, y: 690, dur: 0.7 },
          { at: 8.4, s: 1.55, x: 1180, y: 430, dur: 0.8 },
          { at: 22.4, s: 2.15, x: 1220, y: 190, dur: 0.7 },
        ],
        highlights: [{ from: 22.6, to: 25, mark: "training", pad: 6 }],
      },
    ],
  },
  {
    id: "staff",
    label: "For staff",
    shots: [
      {
        clip: "intake-add",
        device: "desktop",
        path: "/admin/intake",
        segments: [
          { from: 4.2, to: 7.8, rate: 2.4 },
          { from: 7.8, to: 13.05, rate: 5 },
          { from: 13.05, to: 16.5, rate: 1.6 },
          { from: 16.5, to: 21.0, rate: 1.8 },
        ],
        cursor: true,
        camera: [
          { at: 0, s: 1.6, x: 1150, y: 690, dur: 0 },
          { at: 7.9, s: 1.7, x: 1180, y: 380, dur: 0.6 },
          { at: 16.3, s: 1.95, x: 1180, y: 470, dur: 0.6 },
        ],
        highlights: [
          { from: 13.2, to: 16.7, box: { x: 1025, y: 268, width: 391, height: 174 }, pad: 4 },
          { from: 17.9, to: 19.95, mark: "confirm", pad: 5 },
        ],
      },
      {
        clip: "intake-approve",
        device: "desktop",
        path: "/admin/intake/…",
        badge: "Research ran in the background · about 4 min later",
        segments: [
          { from: 4.0, to: 10.4, rate: 3 },
          { from: 10.4, to: 13.6, rate: 1.25 },
        ],
        cursor: true,
        camera: [
          { at: 0, s: 1.3, x: 640, y: 470, dur: 0 },
          { at: 10.3, s: 2.0, x: 330, y: 700, dur: 0.6 },
          { at: 12.1, s: 1.7, x: 420, y: 380, dur: 0.6 },
        ],
        highlights: [
          { from: 10.5, to: 11.65, mark: "approve", pad: 6 },
          { from: 12.3, to: 13.7, box: { x: 32, y: 334, width: 640, height: 100 }, pad: 4 },
        ],
      },
    ],
  },
  {
    id: "screen",
    label: "Lab screen · MCP",
    shots: [
      {
        clip: "kiosk",
        device: "tv",
        segments: [{ from: 0.5, to: 4.9, rate: 1 }],
        camera: [
          { at: 0, s: 1, dur: 0 },
          { at: 0.6, s: 1.18, x: 640, y: 560, dur: 3.8 },
        ],
      },
      {
        clip: "mcp",
        device: "desktop",
        path: "/mcp",
        segments: [{ from: 0.2, to: 4.2, rate: 1 }],
        cursor: true,
        camera: [
          { at: 0, s: 1.05, x: 720, y: 400, dur: 0 },
          { at: 0.9, s: 1.65, x: 720, y: 420, dur: 1.2 },
        ],
        highlights: [{ from: 1.6, to: 4.3, box: { x: 280, y: 436, width: 880, height: 40 }, pad: 6 }],
      },
    ],
  },
];

/** Seconds; the end card fills the rest of the minute. */
export const END_CARD_SECONDS = 6.3;
export const FPS = 30;

export const segmentSeconds = (s: Segment) => (s.to - s.from) / s.rate;
export const shotSeconds = (shot: Shot) => shot.segments.reduce((n, s) => n + segmentSeconds(s), 0);
export const sceneSeconds = (scene: Scene) => scene.shots.reduce((n, s) => n + shotSeconds(s), 0);
export const totalSeconds = () => SCENES.reduce((n, s) => n + sceneSeconds(s), 0) + END_CARD_SECONDS;
