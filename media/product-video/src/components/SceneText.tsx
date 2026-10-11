import { interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../brand";
import type { Format } from "../layout";

/** The site's breadcrumb voice: "// OPERATE", top-left (16:9) or top-centre (9:16). */
export const SceneLabel: React.FC<{ text: string; format: Format; index: number; total: number }> = ({ text, format, index, total }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const p = spring({ frame, fps, config: { damping: 18, stiffness: 140 } });
  const landscape = format === "landscape";
  return (
    <div
      style={{
        position: "absolute",
        left: landscape ? 52 : 0,
        right: landscape ? undefined : 0,
        top: landscape ? 18 : 120,
        display: "flex",
        justifyContent: landscape ? "flex-start" : "center",
        opacity: p,
        transform: `translateX(${landscape ? (1 - p) * -30 : 0}px) translateY(${landscape ? 0 : (1 - p) * -20}px)`,
      }}
    >
      <div
        style={{
          fontFamily: FONTS.mono,
          fontSize: landscape ? 22 : 34,
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: COLORS.ink,
          background: "rgba(247,244,238,0.92)",
          border: `1px solid ${COLORS.outline}`,
          padding: landscape ? "8px 14px" : "12px 22px",
          borderRadius: 6,
          display: "flex",
          gap: 14,
          alignItems: "center",
        }}
      >
        <span style={{ color: COLORS.primaryInk }}>//</span>
        <span>{text}</span>
        <span style={{ color: COLORS.inkMuted, fontSize: landscape ? 18 : 26 }}>
          {String(index).padStart(2, "0")}/{String(total).padStart(2, "0")}
        </span>
      </div>
    </div>
  );
};

/** 16:9 phone scenes: a big statement in the left column. */
export const Headline: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const lines = text.split("\n");
  return (
    <div style={{ position: "absolute", left: 110, top: 200, width: 820 }}>
      {lines.map((l, i) => {
        const p = spring({ frame: frame - 6 - i * 7, fps, config: { damping: 16, stiffness: 130 } });
        return (
          <div
            key={i}
            style={{
              fontFamily: FONTS.display,
              fontWeight: 700,
              fontSize: 104,
              lineHeight: 1.0,
              letterSpacing: "-0.02em",
              textTransform: "uppercase",
              color: i === lines.length - 1 ? COLORS.primaryInk : COLORS.ink,
              opacity: p,
              transform: `translateY(${(1 - p) * 40}px)`,
              clipPath: `inset(0 0 ${interpolate(p, [0, 1], [60, 0])}% 0)`,
            }}
          >
            {l}
          </div>
        );
      })}
    </div>
  );
};
