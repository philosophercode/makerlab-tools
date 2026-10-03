import hookQr from "../public/footage/hook-qr.json";
import intakeAdd from "../public/footage/intake-add.json";
import intakeApprove from "../public/footage/intake-approve.json";
import kiosk from "../public/footage/kiosk.json";
import mcp from "../public/footage/mcp.json";
import phoneAsk from "../public/footage/phone-ask.json";
import phoneReport from "../public/footage/phone-report.json";
import plan from "../public/footage/plan.json";
import staffQueue from "../public/footage/staff-queue.json";
import type { Segment, Shot } from "./edit";

/** What capture/recorder.ts wrote beside each clip. */
export type Box = { x: number; y: number; width: number; height: number };
type Event =
  | { t: number; type: "pointer"; x: number; y: number }
  | { t: number; type: "click"; x: number; y: number }
  | { t: number; type: "type"; text: string }
  | { t: number; type: "mark"; name: string; box: Box | null }
  | { t: number; type: "note"; text: string };
export type Timeline = {
  clip: string;
  viewport: { width: number; height: number };
  duration: number;
  events: Event[];
};

const TIMELINES: Record<string, Timeline> = Object.fromEntries(
  [hookQr, intakeAdd, intakeApprove, kiosk, mcp, phoneAsk, phoneReport, plan, staffQueue].map((t) => [
    (t as Timeline).clip,
    t as Timeline,
  ])
);

export function timeline(clip: string): Timeline {
  const t = TIMELINES[clip];
  if (!t) throw new Error(`no timeline for clip "${clip}"`);
  return t;
}

/** Shot-local seconds → source seconds. */
export function toSource(segments: Segment[], local: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = (s.to - s.from) / s.rate;
    if (local < acc + len) return s.from + (local - acc) * s.rate;
    acc += len;
  }
  const last = segments[segments.length - 1];
  return last.to;
}

/** Source seconds → shot-local seconds (a time inside a cut snaps to the next segment). */
export function toLocal(segments: Segment[], source: number): number {
  let acc = 0;
  for (const s of segments) {
    const len = (s.to - s.from) / s.rate;
    if (source < s.from) return acc;
    if (source <= s.to) return acc + (source - s.from) / s.rate;
    acc += len;
  }
  return acc;
}

/** The segment playing at a shot-local time. */
export function segmentAt(segments: Segment[], local: number): Segment {
  let acc = 0;
  for (const s of segments) {
    const len = (s.to - s.from) / s.rate;
    if (local < acc + len) return s;
    acc += len;
  }
  return segments[segments.length - 1];
}

export function pointerAt(clip: string, t: number): { x: number; y: number } | null {
  let last: { x: number; y: number } | null = null;
  for (const e of timeline(clip).events) {
    if (e.t > t) break;
    if (e.type === "pointer" || e.type === "click") last = { x: e.x, y: e.y };
  }
  return last;
}

export function clicks(clip: string): { t: number; x: number; y: number }[] {
  return timeline(clip).events.filter((e): e is Extract<Event, { type: "click" }> => e.type === "click");
}

export function markBox(clip: string, name: string): Box | null {
  const e = timeline(clip).events.find((x) => x.type === "mark" && x.name === name);
  return e && e.type === "mark" ? e.box : null;
}

export function shotTimeline(shot: Shot): Timeline {
  return timeline(shot.clip);
}
