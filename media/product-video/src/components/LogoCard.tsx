import { AbsoluteFill, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../brand";
import type { Format } from "../layout";
import { Background } from "./Background";

/** Booth-loop opener: the MakerLAB wordmark + "MakerLAB AI" on the paper background. Fades out at the end. */
export const LogoCard: React.FC<{ format: Format; seconds: number }> = ({ format, seconds }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const landscape = format === "landscape";
  const at = (delay: number) => spring({ frame: frame - delay, fps, config: { damping: 18, stiffness: 120 } });
  const mark = at(0);
  const name = at(8);
  const out = interpolate(frame, [seconds * fps - 8, seconds * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const wordW = landscape ? 900 : 860;
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: landscape ? 40 : 50 }}>
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
            fontSize: landscape ? 110 : 100,
            letterSpacing: "-0.01em",
            color: COLORS.ink,
            opacity: name,
            transform: `translateY(${(1 - name) * 24}px)`,
            display: "flex",
            alignItems: "center",
            gap: 26,
          }}
        >
          <span style={{ width: 26, height: 26, background: COLORS.primary, display: "inline-block" }} />
          MakerLAB AI
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
