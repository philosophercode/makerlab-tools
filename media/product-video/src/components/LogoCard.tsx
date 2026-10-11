import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import type { Format } from "../layout";
import { Background } from "./Background";
import { Lockup, OpenSourceLine } from "./Lockup";

/** Booth-loop opener: the current MakerLAB AI lockup on the paper background. Fades out at the end. */
export const LogoCard: React.FC<{ format: Format; seconds: number }> = ({ format, seconds }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const landscape = format === "landscape";
  const mark = spring({ frame, fps, config: { damping: 18, stiffness: 120 } });
  const oss = interpolate(frame, [20, 34], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const out = interpolate(frame, [seconds * fps - 8, seconds * fps], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: out }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 60 }}>
        <div style={{ opacity: mark, transform: `translateY(${(1 - mark) * 30}px) scale(${0.96 + 0.04 * mark})` }}>
          <Lockup height={landscape ? 120 : 90} />
        </div>
        <div style={{ opacity: oss }}>
          <OpenSourceLine size={landscape ? 28 : 26} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
