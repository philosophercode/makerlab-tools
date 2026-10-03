import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { FONTS } from "../brand";
import type { Format } from "../layout";
import { SCRIPT } from "../script";

/**
 * Burned-in captions of the voiceover script, revealed word by word across
 * each line's window. During `sideRanges` (frames) they sit in the left column,
 * beside a phone.
 */
export const Captions: React.FC<{ format: Format; sideRanges: [number, number][] }> = ({ format, sideRanges }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const side = sideRanges.some(([a, b]) => frame >= a && frame < b);
  const t = frame / fps;
  const line = SCRIPT.find((l) => t >= l.start - 0.1 && t <= l.end + 0.25);
  if (!line || line.id === "end") return null;
  const words = line.text.split(" ");
  const span = Math.max(0.5, (line.end - line.start) * 0.82);
  const out = interpolate(t, [line.end, line.end + 0.25], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const boxIn = spring({ frame: (t - line.start + 0.1) * fps, fps, config: { damping: 18, stiffness: 180 } });
  const landscape = format === "landscape";
  const fontSize = landscape ? (side ? 40 : 38) : 50;
  const position: React.CSSProperties = landscape
    ? side
      ? { left: 110, width: 580, bottom: 96 }
      : { left: "50%", bottom: 34, maxWidth: 1480, transform: `translateX(-50%)` }
    : { left: 60, right: 60, bottom: 110 };
  return (
    <div style={{ position: "absolute", ...position, display: "flex", justifyContent: landscape && side ? "flex-start" : "center" }}>
      <div
        style={{
          opacity: out * boxIn,
          transform: `translateY(${(1 - boxIn) * 16}px)`,
          background: "rgba(23,23,23,0.9)",
          color: "#fff",
          borderRadius: 18,
          padding: landscape ? "16px 28px 18px" : "22px 30px 24px",
          fontFamily: FONTS.body,
          fontWeight: 560,
          fontSize,
          lineHeight: 1.28,
          letterSpacing: "-0.01em",
          textAlign: landscape && side ? "left" : "center",
          boxShadow: "0 24px 60px -24px rgba(0,0,0,0.55)",
        }}
      >
        {words.map((w, i) => {
          const at = line.start + (span * i) / words.length;
          const p = spring({ frame: (t - at) * fps, fps, config: { damping: 16, stiffness: 220 } });
          const fresh = interpolate(t - at, [0, 0.35], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <span
              key={i}
              style={{
                display: "inline-block",
                marginRight: "0.26em",
                opacity: interpolate(p, [0, 1], [0.3, 1]),
                transform: `translateY(${(1 - p) * 10}px)`,
                color: fresh > 0.05 && p > 0.1 ? mix(fresh) : "#fff",
              }}
            >
              {w}
            </span>
          );
        })}
      </div>
    </div>
  );
};

/** White, warmed toward the brand orange while a word is new. */
function mix(f: number): string {
  const a = [255, 255, 255];
  const b = [255, 140, 95];
  const c = a.map((v, i) => Math.round(v + (b[i] - v) * f));
  return `rgb(${c.join(",")})`;
}

