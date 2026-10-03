import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../brand";
import type { Format } from "../layout";
import { Background } from "./Background";

/** "MakerLAB AI · Operate, fix and build." + the address, in the site's lockup. */
export const EndCard: React.FC<{ format: Format }> = ({ format }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const landscape = format === "landscape";
  const at = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
  const mark = at(0);
  const name = at(8);
  const tag = at(16);
  const url = at(26);
  const wordW = landscape ? 640 : 760;
  const words = ["Operate,", "fix", "and", "build."];
  return (
    <AbsoluteFill>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: landscape ? 26 : 40 }}>
        <div
          style={{
            width: wordW,
            height: wordW * (79 / 475),
            backgroundColor: COLORS.ink,
            WebkitMaskImage: `url(${staticFile("brand/makerlab-wordmark.png")})`,
            maskImage: `url(${staticFile("brand/makerlab-wordmark.png")})`,
            WebkitMaskSize: "contain",
            maskSize: "contain",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            opacity: mark,
            transform: `translateY(${(1 - mark) * 30}px) scale(${0.96 + 0.04 * mark})`,
          }}
        />
        <div
          style={{
            fontFamily: FONTS.display,
            fontWeight: 700,
            fontSize: landscape ? 76 : 92,
            letterSpacing: "-0.01em",
            color: COLORS.ink,
            opacity: name,
            transform: `translateY(${(1 - name) * 24}px)`,
            display: "flex",
            alignItems: "center",
            gap: 22,
          }}
        >
          <span style={{ width: landscape ? 18 : 22, height: landscape ? 18 : 22, background: COLORS.primary, display: "inline-block" }} />
          MakerLAB AI
        </div>
        <div style={{ display: "flex", gap: "0.3em", fontFamily: FONTS.display, fontWeight: 500, fontSize: landscape ? 46 : 58, color: COLORS.inkMuted, opacity: tag }}>
          {words.map((w, i) => {
            const p = at(16 + i * 4);
            return (
              <span key={w} style={{ display: "inline-block", opacity: p, transform: `translateY(${(1 - p) * 16}px)`, color: i === 3 ? COLORS.primaryInk : undefined }}>
                {w}
              </span>
            );
          })}
        </div>
        <div
          style={{
            marginTop: landscape ? 18 : 30,
            fontFamily: FONTS.mono,
            fontSize: landscape ? 30 : 38,
            letterSpacing: "0.04em",
            color: COLORS.ink,
            border: `2px solid ${COLORS.ink}`,
            padding: landscape ? "14px 26px" : "18px 30px",
            opacity: url,
            transform: `translateY(${(1 - url) * 16}px)`,
            background: "rgba(255,255,255,0.5)",
          }}
        >
          <span style={{ color: COLORS.primaryInk }}>→ </span>makerlab-ai.vercel.app
        </div>
        <div
          style={{
            position: "absolute",
            bottom: landscape ? 46 : 120,
            fontFamily: FONTS.mono,
            fontSize: landscape ? 18 : 24,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: COLORS.inkMuted,
            opacity: interpolate(frame, [40, 60], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }),
          }}
        >
          The MakerLAB at Cornell Tech
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
