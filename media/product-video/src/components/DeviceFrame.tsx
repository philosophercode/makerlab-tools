import { COLORS, FONTS } from "../brand";
import type { Device } from "../edit";
import { barHeight, type DeviceLayout, type Format } from "../layout";

const DOMAIN = "makerlab-ai.vercel.app";

export const statusBarHeight = (screenHeight: number) => screenHeight * 0.058;

/**
 * The chrome around the footage: a plain browser window, a phone, or a wall
 * screen. Framing only; everything inside the screen is the recorded app.
 */
export const DeviceFrame: React.FC<{
  device: Device;
  layout: DeviceLayout;
  format: Format;
  path?: string;
  children: React.ReactNode;
}> = ({ device, layout, format, path, children }) => {
  const { left, top, width, height } = layout.screen;
  if (device === "phone") {
    const bezel = format === "landscape" ? 13 : 20;
    const radius = format === "landscape" ? 58 : 92;
    // A status bar above the page, as a phone browser shows it.
    const sb = statusBarHeight(height);
    const fs = sb * 0.36;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: left - bezel,
            top: top - sb - bezel,
            width: width + bezel * 2,
            height: height + sb + bezel * 2,
            borderRadius: radius,
            background: "#121212",
            boxShadow: "0 60px 120px -30px rgba(40,25,10,0.45), 0 20px 40px -20px rgba(40,25,10,0.35), inset 0 0 0 2px #3a3a3a",
          }}
        />
        <div
          style={{
            position: "absolute",
            left,
            top: top - sb,
            width,
            height: height + sb,
            borderRadius: radius - bezel,
            overflow: "hidden",
            background: COLORS.background,
          }}
        >
          <div style={{ height: sb, display: "flex", alignItems: "center", justifyContent: "space-between", padding: `0 ${width * 0.09}px`, fontFamily: FONTS.body, fontWeight: 600, fontSize: fs, color: COLORS.ink }}>
            <span>9:41</span>
            <span style={{ display: "flex", gap: fs * 0.35, alignItems: "flex-end" }}>
              {[0.35, 0.55, 0.75, 0.95].map((h) => (
                <span key={h} style={{ width: fs * 0.22, height: fs * h, background: COLORS.ink, borderRadius: 2 }} />
              ))}
              <span style={{ width: fs * 1.6, height: fs * 0.8, border: `2px solid ${COLORS.ink}`, borderRadius: 4, marginLeft: fs * 0.3, padding: 1 }}>
                <span style={{ display: "block", width: "80%", height: "100%", background: COLORS.ink, borderRadius: 2 }} />
              </span>
            </span>
          </div>
          <div style={{ position: "absolute", left: 0, top: sb, width, height, overflow: "hidden" }}>{children}</div>
        </div>
        <div
          style={{
            position: "absolute",
            left: left + width / 2 - width * 0.15,
            top: top - sb + sb * 0.22,
            width: width * 0.3,
            height: sb * 0.56,
            borderRadius: 999,
            background: "#050505",
          }}
        />
      </>
    );
  }
  if (device === "tv") {
    const bezel = format === "landscape" ? 16 : 12;
    return (
      <>
        <div
          style={{
            position: "absolute",
            left: left - bezel,
            top: top - bezel,
            width: width + bezel * 2,
            height: height + bezel * 2,
            borderRadius: 14,
            background: "#0b0b0b",
            boxShadow: "0 70px 120px -40px rgba(0,0,0,0.6), inset 0 0 0 2px #2b2b2b",
          }}
        />
        <div style={{ position: "absolute", left, top, width, height, overflow: "hidden", background: COLORS.night }}>{children}</div>
      </>
    );
  }
  const bar = barHeight(format);
  const scale = bar / 40;
  return (
    <>
      <div
        style={{
          position: "absolute",
          left,
          top: top - bar,
          width,
          height: height + bar,
          borderRadius: 14 * scale,
          background: "#fbf9f5",
          boxShadow: "0 50px 100px -30px rgba(40,25,10,0.38), 0 18px 36px -18px rgba(40,25,10,0.3), 0 0 0 1px rgba(23,23,23,0.12)",
          overflow: "hidden",
        }}
      >
        <div style={{ height: bar, display: "flex", alignItems: "center", padding: `0 ${16 * scale}px`, gap: 8 * scale, borderBottom: "1px solid rgba(23,23,23,0.1)", background: "#efebe4" }}>
          {["#ff5f57", "#febc2e", "#28c840"].map((c) => (
            <div key={c} style={{ width: 12 * scale, height: 12 * scale, borderRadius: 99, background: c }} />
          ))}
          <div
            style={{
              margin: "0 auto",
              height: bar * 0.62,
              minWidth: width * 0.36,
              borderRadius: 8 * scale,
              background: "#fbf9f5",
              border: "1px solid rgba(23,23,23,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: FONTS.body,
              fontSize: 15 * scale,
              color: COLORS.inkMuted,
              padding: `0 ${14 * scale}px`,
              transform: `translateX(-${30 * scale}px)`,
            }}
          >
            <span style={{ color: COLORS.ink }}>{DOMAIN}</span>
            <span>{path && path !== "/" ? path : ""}</span>
          </div>
        </div>
      </div>
      <div style={{ position: "absolute", left, top, width, height, overflow: "hidden", borderRadius: `0 0 ${14 * scale}px ${14 * scale}px` }}>{children}</div>
    </>
  );
};
