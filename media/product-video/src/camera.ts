import { Easing } from "remotion";
import type { CameraMove, Segment } from "./edit";
import type { DeviceLayout } from "./layout";
import { toLocal } from "./timeline";

type State = { s: number; fx: number; fy: number };
const ease = Easing.bezier(0.65, 0, 0.35, 1);

/**
 * Where the camera is at a shot-local time: scale `s` about focus (fx, fy) in
 * stage pixels, with the focus drawn at `anchor` (the device's centre).
 * `s: 1` with no point is the plain framing.
 */
export function cameraAt(
  moves: CameraMove[],
  segments: Segment[],
  layout: DeviceLayout,
  anchor: { x: number; y: number },
  zoom: (s: number) => number,
  local: number
): State {
  const targets = moves.map((m) => ({
    at: toLocal(segments, m.at),
    dur: m.dur ?? 0.8,
    state: target(m, layout, anchor, zoom),
  }));
  const valueAt = (t: number, upto: number): State => {
    let v = targets[0].state;
    for (let i = 1; i <= upto && i < targets.length; i++) {
      const m = targets[i];
      if (t <= m.at) break;
      const start = valueAt(m.at, i - 1);
      const p = m.dur <= 0 ? 1 : ease(Math.min(1, (t - m.at) / m.dur));
      v = {
        s: start.s + (m.state.s - start.s) * p,
        fx: start.fx + (m.state.fx - start.fx) * p,
        fy: start.fy + (m.state.fy - start.fy) * p,
      };
    }
    return v;
  };
  return valueAt(local, targets.length - 1);
}

function target(m: CameraMove, layout: DeviceLayout, anchor: { x: number; y: number }, zoom: (s: number) => number): State {
  if (m.s <= 1 || m.x === undefined || m.y === undefined) return { s: 1, fx: anchor.x, fy: anchor.y };
  return {
    s: zoom(m.s),
    fx: layout.screen.left + m.x * layout.k,
    fy: layout.screen.top + m.y * layout.k,
  };
}

/**
 * The CSS transform for a camera state, keeping the device covering the
 * frame once it is zoomed far enough to (no background slivers at the edges).
 */
export function cameraTransform(
  st: State,
  anchor: { x: number; y: number },
  bounds: { left: number; top: number; width: number; height: number },
  stage: { width: number; height: number }
): string {
  let { fx, fy } = st;
  const { s } = st;
  if (s > 1) {
    if (bounds.width * s >= stage.width) {
      const min = bounds.left + anchor.x / s;
      const max = bounds.left + bounds.width - (stage.width - anchor.x) / s;
      fx = Math.min(max, Math.max(min, fx));
    }
    if (bounds.height * s >= stage.height) {
      const min = bounds.top + anchor.y / s;
      const max = bounds.top + bounds.height - (stage.height - anchor.y) / s;
      fy = Math.min(max, Math.max(min, fy));
    }
  }
  return `translate(${anchor.x - fx * s}px, ${anchor.y - fy * s}px) scale(${s})`;
}
