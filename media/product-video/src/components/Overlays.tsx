import { interpolate, spring, useVideoConfig } from "remotion";
import { COLORS } from "../brand";
import type { Highlight, Shot } from "../edit";
import type { DeviceLayout } from "../layout";
import { clicks, markBox, pointerAt } from "../timeline";

/**
 * Drawn over the footage in stage pixels, inside the camera (so it zooms with
 * the page): the pointer or finger, click ripples, and focus rings. Positions
 * come from the clip's timeline, so they sit exactly where the script clicked.
 */
export const Overlays: React.FC<{ shot: Shot; layout: DeviceLayout; source: number; scale: number }> = ({
  shot,
  layout,
  source,
  scale,
}) => {
  const touch = shot.device === "phone";
  const toStage = (x: number, y: number) => ({ x: layout.screen.left + x * layout.k, y: layout.screen.top + y * layout.k });
  return (
    <>
      {(shot.highlights ?? []).map((h, i) => (
        <Ring key={i} h={h} shot={shot} layout={layout} source={source} scale={scale} />
      ))}
      {shot.cursor !== false && (touch ? <Finger shot={shot} source={source} toStage={toStage} k={layout.k} /> : <Pointer shot={shot} source={source} toStage={toStage} k={layout.k} />)}
    </>
  );
};

type ToStage = (x: number, y: number) => { x: number; y: number };

const Pointer: React.FC<{ shot: Shot; source: number; toStage: ToStage; k: number }> = ({ shot, source, toStage, k }) => {
  const p = pointerAt(shot.clip, source);
  if (!p) return null;
  const at = toStage(p.x, p.y);
  const click = clicks(shot.clip).find((c) => source >= c.t - 0.12 && source <= c.t + 0.5);
  const press = click ? interpolate(source - click.t, [-0.12, 0, 0.18], [1, 0.82, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1;
  const size = 30 * k;
  return (
    <>
      {clicks(shot.clip).map((c) => <Ripple key={c.t} t={source - c.t} at={toStage(c.x, c.y)} k={k} />)}
      <svg
        width={size}
        height={size * 1.25}
        viewBox="0 0 24 30"
        style={{
          position: "absolute",
          left: at.x - size * 0.12,
          top: at.y - size * 0.08,
          transform: `scale(${press})`,
          transformOrigin: "12% 8%",
          filter: "drop-shadow(0 3px 5px rgba(0,0,0,0.35))",
        }}
      >
        <path d="M2 1.5 L2 24 L8 18.5 L12 28 L16 26.3 L12.2 17 L20.5 17 Z" fill="#111" stroke="#fff" strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
    </>
  );
};

const Finger: React.FC<{ shot: Shot; source: number; toStage: ToStage; k: number }> = ({ shot, source, toStage, k }) => {
  return (
    <>
      {clicks(shot.clip).map((c) => {
        const t = source - c.t;
        if (t < -0.35 || t > 0.6) return null;
        const at = toStage(c.x, c.y);
        const o = interpolate(t, [-0.35, -0.1, 0.25, 0.6], [0, 0.9, 0.9, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const s = interpolate(t, [-0.35, 0, 0.12], [1.25, 0.85, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const r = 26 * k;
        return (
          <div key={c.t}>
            <Ripple t={t} at={at} k={k} />
            <div
              style={{
                position: "absolute",
                left: at.x - r,
                top: at.y - r,
                width: r * 2,
                height: r * 2,
                borderRadius: 999,
                background: "rgba(255,255,255,0.55)",
                border: `${3 * k}px solid rgba(23,23,23,0.55)`,
                boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
                opacity: o,
                transform: `scale(${s})`,
              }}
            />
          </div>
        );
      })}
    </>
  );
};

const Ripple: React.FC<{ t: number; at: { x: number; y: number }; k: number }> = ({ t, at, k }) => {
  if (t < 0 || t > 0.55) return null;
  const r = interpolate(t, [0, 0.55], [8, 46], { easing: (x) => 1 - Math.pow(1 - x, 3) }) * k;
  const o = interpolate(t, [0, 0.55], [0.9, 0]);
  return (
    <div
      style={{
        position: "absolute",
        left: at.x - r,
        top: at.y - r,
        width: r * 2,
        height: r * 2,
        borderRadius: 999,
        border: `${3.5 * k}px solid ${COLORS.primary}`,
        background: "rgba(255,107,53,0.14)",
        opacity: o,
      }}
    />
  );
};

const Ring: React.FC<{ h: Highlight; shot: Shot; layout: DeviceLayout; source: number; scale: number }> = ({ h, shot, layout, source, scale }) => {
  const { fps } = useVideoConfig();
  const box = h.box ?? (h.mark ? markBox(shot.clip, h.mark) : null);
  if (!box || source < h.from || source > h.to) return null;
  const pad = (h.pad ?? 6) * layout.k;
  const inFrames = (source - h.from) * fps;
  const enter = spring({ frame: inFrames, fps, config: { damping: 14, stiffness: 160 } });
  const exit = interpolate(h.to - source, [0, 0.2], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const x = layout.screen.left + box.x * layout.k - pad;
  const y = layout.screen.top + box.y * layout.k - pad;
  const w = box.width * layout.k + pad * 2;
  const hh = box.height * layout.k + pad * 2;
  const line = 3.5 / Math.max(1, scale);
  return (
    <div
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: w,
        height: hh,
        borderRadius: 8 / Math.max(1, scale) + 2,
        border: `${line}px solid ${COLORS.primary}`,
        boxShadow: `0 0 0 ${6 / Math.max(1, scale)}px rgba(255,107,53,0.18), 0 0 ${24 / Math.max(1, scale)}px rgba(255,107,53,0.35)`,
        opacity: enter * exit,
        transform: `scale(${1.12 - 0.12 * enter})`,
      }}
    />
  );
};
