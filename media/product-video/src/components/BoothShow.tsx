import { AbsoluteFill, Img, interpolate, Sequence, staticFile } from "remotion";
import { COLORS, FONTS } from "../brand";
import { Background } from "./Background";
import { LogoCard } from "./LogoCard";
import { Lockup, OpenSourceLine } from "./Lockup";

/** Booth loop: logo card, fresh stills of the live site (Ken Burns), logo end card that fades into the opener's background. */
const STILLS = [
  { file: "home", label: "Browse the whole lab", fx: [1.0, 1.08, 0, 0] },
  { file: "tool", label: "Every tool, with the real manual", fx: [1.08, 1.0, 0, 20] },
  { file: "about", label: "Meet the lab", fx: [1.08, 1.0, 0, 0] },
  { file: "demo", label: "Bring MakerLAB AI to your makerspace", fx: [1.0, 1.08, 0, 10] },
] as const;

export const LOGO_S = 3;
export const STILL_S = 6;
export const END_S = 5;
export const BOOTH_SECONDS = LOGO_S + STILL_S * STILLS.length + END_S;
const FADE = 12;

const Still: React.FC<{ file: string; label: string; fx: readonly number[]; frames: number }> = ({ file, label, fx, frames }) => {
  return <StillInner file={file} label={label} fx={fx} frames={frames} />;
};

import { useCurrentFrame } from "remotion";
const StillInner: React.FC<{ file: string; label: string; fx: readonly number[]; frames: number }> = ({ file, label, fx, frames }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, frames], [0, 1]);
  const scale = fx[0] + (fx[1] - fx[0]) * t;
  const ty = fx[2] * (1 - t) - fx[3] * t;
  const opacity = interpolate(frame, [0, FADE, frames - FADE, frames], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity }}>
      <Background />
      <AbsoluteFill style={{ padding: "70px 110px 130px" }}>
        <div style={{ flex: 1, overflow: "hidden", border: `2px solid ${COLORS.ink}`, boxShadow: "0 24px 60px rgba(0,0,0,0.18)", background: "#fff" }}>
          <Img src={staticFile(`booth/${file}.png`)} style={{ width: "100%", height: "100%", objectFit: "cover", transform: `scale(${scale}) translateY(${ty}px)`, transformOrigin: "50% 40%" }} />
        </div>
      </AbsoluteFill>
      <div style={{ position: "absolute", left: 110, bottom: 44, fontFamily: FONTS.mono, fontSize: 30, letterSpacing: "0.08em", textTransform: "uppercase", color: COLORS.ink }}>
        <span style={{ color: COLORS.primaryInk }}>// </span>
        {label}
      </div>
    </AbsoluteFill>
  );
};

const BoothEnd: React.FC<{ frames: number }> = ({ frames }) => {
  const frame = useCurrentFrame();
  const inn = interpolate(frame, [0, FADE], [0, 1], { extrapolateRight: "clamp" });
  const out = interpolate(frame, [frames - 8, frames], [1, 0], { extrapolateLeft: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: Math.min(inn, out) }}>
      <Background />
      <AbsoluteFill style={{ alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 44 }}>
        <Lockup height={110} />
        <div style={{ fontFamily: FONTS.display, fontWeight: 500, fontSize: 48, color: COLORS.inkMuted }}>
          Operate, fix and <span style={{ color: COLORS.primaryInk }}>build.</span>
        </div>
        <div style={{ fontFamily: FONTS.mono, fontSize: 32, color: COLORS.ink, border: `2px solid ${COLORS.ink}`, padding: "14px 26px", background: "rgba(255,255,255,0.5)" }}>
          <span style={{ color: COLORS.primaryInk }}>→ </span>makerlabai.app
        </div>
        <OpenSourceLine size={28} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

export const BoothShow: React.FC = () => {
  const fps = 30;
  const f = (s: number) => Math.round(s * fps);
  return (
    <AbsoluteFill>
      <Background />
      <Sequence from={0} durationInFrames={f(LOGO_S)} name="logo card">
        <LogoCard format="landscape" seconds={LOGO_S} />
      </Sequence>
      {STILLS.map((s, i) => (
        <Sequence key={s.file} from={f(LOGO_S + i * STILL_S)} durationInFrames={f(STILL_S)} name={s.file}>
          <Still file={s.file} label={s.label} fx={s.fx} frames={f(STILL_S)} />
        </Sequence>
      ))}
      <Sequence from={f(LOGO_S + STILL_S * STILLS.length)} durationInFrames={f(END_S)} name="end card">
        <BoothEnd frames={f(END_S)} />
      </Sequence>
    </AbsoluteFill>
  );
};
