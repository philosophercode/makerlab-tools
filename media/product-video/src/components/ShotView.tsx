import { AbsoluteFill, interpolate, OffthreadVideo, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { COLORS, FONTS } from "../brand";
import { cameraAt, cameraTransform } from "../camera";
import type { Shot } from "../edit";
import { barHeight, deviceLayout, SIZE, zoomFor, type Format } from "../layout";
import { segmentAt, timeline, toSource } from "../timeline";
import { DeviceFrame, statusBarHeight } from "./DeviceFrame";
import { Overlays } from "./Overlays";
import { Headline } from "./SceneText";

/**
 * One recorded clip, cut into its segments (each at its own speed), framed in
 * its device, with the camera, pointer and focus rings on top.
 */
export const ShotView: React.FC<{ shot: Shot; format: Format; hasSide: boolean; headline?: string }> = ({ shot, format, hasSide, headline }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const stage = SIZE[format];
  const tl = timeline(shot.clip);
  const layout = deviceLayout(format, shot.device, tl.viewport, hasSide);
  const local = frame / fps;
  const source = toSource(shot.segments, local);
  const { left, top, width, height } = layout.screen;

  // The device's outer bounds, for the camera's edge clamp.
  const extraTop = shot.device === "desktop" ? barHeight(format) : shot.device === "phone" ? statusBarHeight(height) : 0;
  const bounds = { left, top: top - extraTop, width, height: height + extraTop };
  const anchor = { x: left + width / 2, y: top - extraTop / 2 + height / 2 };
  const cam = cameraAt(shot.camera, shot.segments, layout, anchor, (z: number) => zoomFor(format, shot.device, z), local);

  // A quick settle on every cut.
  const enter = interpolate(frame, [0, 7], [0, 1], { extrapolateRight: "clamp", easing: (x) => 1 - Math.pow(1 - x, 3) });

  let start = 0;
  let acc = 0;
  const pieces = shot.segments.map((seg, i) => {
    acc += (seg.to - seg.from) / seg.rate;
    const end = Math.round(acc * fps);
    const piece = (
      <Sequence key={i} from={start} durationInFrames={Math.max(1, end - start)} layout="none">
        <OffthreadVideo
          src={staticFile(`footage/${shot.clip}.mp4`)}
          trimBefore={Math.round(seg.from * 30)}
          playbackRate={seg.rate}
          muted
          style={{ width, height, display: "block" }}
        />
      </Sequence>
    );
    start = end;
    return piece;
  });

  const rate = segmentAt(shot.segments, local).rate;
  return (
    <AbsoluteFill>
      {/* Beside a phone: the headline gives way as the camera moves in. */}
      {headline && (
        <AbsoluteFill style={{ opacity: interpolate(cam.s, [1, 1.2], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) }}>
          <Headline text={headline} />
        </AbsoluteFill>
      )}
      <AbsoluteFill
        style={{
          transform: `${cameraTransform(cam, anchor, bounds, stage)}`,
          transformOrigin: "0 0",
          opacity: enter,
        }}
      >
        <AbsoluteFill style={{ transform: `translateY(${(1 - enter) * 24}px) scale(${1 + (1 - enter) * 0.02})`, transformOrigin: `${anchor.x}px ${anchor.y}px` }}>
          <DeviceFrame device={shot.device} layout={layout} format={format} path={shot.path}>
            {pieces}
          </DeviceFrame>
          <Overlays shot={shot} layout={layout} source={source} scale={cam.s} />
        </AbsoluteFill>
      </AbsoluteFill>
      {rate >= 2 && <SpeedPill rate={rate} format={format} />}
      {shot.badge && <Badge text={shot.badge} format={format} local={local} />}
    </AbsoluteFill>
  );
};

const SpeedPill: React.FC<{ rate: number; format: Format }> = ({ rate, format }) => (
  <div
    style={{
      position: "absolute",
      right: format === "landscape" ? 48 : 40,
      top: format === "landscape" ? 34 : 120,
      padding: "8px 16px",
      borderRadius: 999,
      background: "rgba(23,23,23,0.86)",
      color: "#fff",
      fontFamily: FONTS.mono,
      fontSize: format === "landscape" ? 22 : 30,
      letterSpacing: "0.06em",
      display: "flex",
      alignItems: "center",
      gap: 10,
    }}
  >
    <span style={{ color: COLORS.primary }}>▶▶</span> {Number.isInteger(rate) ? rate : rate.toFixed(1)}×
  </div>
);

const Badge: React.FC<{ text: string; format: Format; local: number }> = ({ text, format, local }) => {
  const o = interpolate(local, [0, 0.25, 1.9, 2.3], [0, 1, 1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <div
      style={{
        position: "absolute",
        left: "50%",
        top: format === "landscape" ? 470 : 860,
        transform: `translate(-50%, ${(1 - o) * 12}px)`,
        opacity: o,
        padding: format === "landscape" ? "18px 30px" : "22px 34px",
        borderRadius: 16,
        background: "rgba(23,23,23,0.9)",
        color: "#fff",
        fontFamily: FONTS.mono,
        fontSize: format === "landscape" ? 26 : 32,
        letterSpacing: "0.04em",
        whiteSpace: format === "landscape" ? "nowrap" : "normal",
        maxWidth: format === "landscape" ? undefined : 900,
        textAlign: "center",
        boxShadow: "0 20px 50px -20px rgba(0,0,0,0.5)",
      }}
    >
      <span style={{ color: COLORS.primary }}>⏱ </span>
      {text}
    </div>
  );
};
