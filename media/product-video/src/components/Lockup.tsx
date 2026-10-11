import { staticFile } from "remotion";
import { COLORS, FONTS } from "../brand";

/** The site's brand lockup: official MakerLAB wordmark (masked, ink) then "AI" in the accent. */
export const Lockup: React.FC<{ height: number }> = ({ height }) => {
  const mask = `url(${staticFile("brand/makerlab-wordmark-official.svg")})`;
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: height * 0.28 }}>
      <div
        style={{
          width: (height * 112.5) / 19.4,
          height,
          backgroundColor: COLORS.ink,
          WebkitMaskImage: mask,
          maskImage: mask,
          WebkitMaskSize: "contain",
          maskSize: "contain",
          WebkitMaskRepeat: "no-repeat",
          maskRepeat: "no-repeat",
        }}
      />
      <div
        style={{
          height,
          display: "flex",
          alignItems: "flex-end",
          color: COLORS.primary,
          fontFamily: FONTS.display,
          fontWeight: 700,
          fontSize: height / 0.7,
          lineHeight: 0.8,
          letterSpacing: "-0.01em",
        }}
      >
        AI
      </div>
    </div>
  );
};

export const OpenSourceLine: React.FC<{ size: number }> = ({ size }) => (
  <div style={{ fontFamily: FONTS.mono, fontSize: size, letterSpacing: "0.06em", color: COLORS.inkMuted, textAlign: "center", lineHeight: 1.5 }}>
    Open source · AGPL-3.0
    <br />
    <span style={{ color: COLORS.ink }}>github.com/philosophercode/makerlab-tools</span>
  </div>
);
