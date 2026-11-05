import { AbsoluteFill, useCurrentFrame } from "remotion";
import { COLORS } from "../brand";

/** The site's paper background and dot grid, with a slow warm glow behind the app. */
export const Background: React.FC<{ dark?: boolean }> = ({ dark }) => {
  const frame = useCurrentFrame();
  const drift = Math.sin(frame / 90) * 60;
  const drift2 = Math.cos(frame / 120) * 80;
  const base = dark ? "#151413" : COLORS.background;
  const dot = dark ? "rgba(247,244,238,0.07)" : "rgba(23,23,23,0.085)";
  return (
    <AbsoluteFill style={{ backgroundColor: base }}>
      <AbsoluteFill
        style={{
          background: `radial-gradient(900px 700px at ${30 + drift / 20}% ${20 + drift2 / 30}%, rgba(255,107,53,${dark ? 0.16 : 0.2}), transparent 70%),
            radial-gradient(800px 800px at ${85 - drift / 25}% ${90 - drift2 / 25}%, rgba(179,27,27,${dark ? 0.1 : 0.08}), transparent 70%)`,
        }}
      />
      <AbsoluteFill
        style={{
          backgroundImage: `radial-gradient(${dot} 1.4px, transparent 1.6px)`,
          backgroundSize: "28px 28px",
          backgroundPosition: `${(frame * 0.15) % 28}px 0px`,
        }}
      />
    </AbsoluteFill>
  );
};
