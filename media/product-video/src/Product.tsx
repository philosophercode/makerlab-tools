import { AbsoluteFill, Sequence, useVideoConfig } from "remotion";
import { Soundtrack } from "./audio";
import { loadFonts } from "./brand";
import { Background } from "./components/Background";
import { Captions } from "./components/Captions";
import { EndCard } from "./components/EndCard";
import { SceneLabel } from "./components/SceneText";
import { ShotView } from "./components/ShotView";
import { END_CARD_SECONDS, SCENES, shotSeconds, type Scene } from "./edit";
import type { Format } from "./layout";

loadFonts();

/** Shot and scene start frames, accumulated in seconds so rounding never drifts. */
export function plan(fps: number) {
  let t = 0;
  const scenes = SCENES.map((scene) => {
    const start = t;
    const shots = scene.shots.map((shot) => {
      const s = t;
      t += shotSeconds(shot);
      return { shot, from: Math.round(s * fps), to: Math.round(t * fps) };
    });
    return { scene, from: Math.round(start * fps), to: Math.round(t * fps), shots };
  });
  const endFrom = Math.round(t * fps);
  return { scenes, endFrom, total: Math.round((t + END_CARD_SECONDS) * fps) };
}

export const Product: React.FC<{ format: Format }> = ({ format }) => {
  const { fps } = useVideoConfig();
  const p = plan(fps);
  const sideFor = (scene: Scene) => format === "landscape" && Boolean(scene.headline) && scene.shots.some((s) => s.device === "phone");
  // Captions sit in the left column while a phone shot has the headline beside it.
  const sideRanges = p.scenes.flatMap(({ scene, shots }) =>
    shots.filter(({ shot }) => sideFor(scene) && shot.device === "phone").map(({ from, to }) => [from, to] as [number, number])
  );
  return (
    <AbsoluteFill>
      <Background />
      {p.scenes.map(({ scene, from, to, shots }, i) => (
        <Sequence key={scene.id} from={from} durationInFrames={to - from} name={scene.id}>
          {shots.map(({ shot, from: sf, to: st }) => {
            const side = sideFor(scene) && shot.device === "phone";
            return (
              <Sequence key={shot.clip} from={sf - from} durationInFrames={st - sf} name={shot.clip}>
                {shot.device === "tv" && <Background dark />}
                <ShotView shot={shot} format={format} hasSide={side} headline={side ? scene.headline : undefined} />
              </Sequence>
            );
          })}
          <SceneLabel text={scene.label} format={format} index={i + 1} total={p.scenes.length} />
        </Sequence>
      ))}
      <Sequence from={p.endFrom} name="end card">
        <EndCard format={format} />
      </Sequence>
      <Captions format={format} sideRanges={sideRanges} />
      <Soundtrack />
    </AbsoluteFill>
  );
};
