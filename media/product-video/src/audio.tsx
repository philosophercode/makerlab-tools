import { Audio, getStaticFiles, interpolate, Sequence, staticFile, useVideoConfig } from "remotion";

/**
 * Sound, by configuration. Drop files into public/ and re-render:
 *
 * - `public/voiceover.mp3` — the recorded script (VOICEOVER.md). Played from 0:00 (shift with `offsetSeconds`).
 * - `public/music.mp3` — optional bed, looped, faded in/out and ducked under
 *   the voice. Only use a track whose licence allows this use, and write the
 *   licence down in README.md ("Music").
 *
 * A file that is absent is simply skipped, so the silent render needs nothing.
 */
export const AUDIO = {
  voiceover: { file: "voiceover.mp3", volume: 1, offsetSeconds: 0 },
  music: { file: "music.mp3", volume: 0.22, duckedVolume: 0.1, fadeSeconds: 1.2 },
  /** Set false to keep captions but mute a file that is present. */
  enabled: true,
};

const has = (file: string) => getStaticFiles().some((f) => f.name === file);

export const Soundtrack: React.FC = () => {
  const { fps, durationInFrames } = useVideoConfig();
  if (!AUDIO.enabled) return null;
  const voice = has(AUDIO.voiceover.file);
  const music = has(AUDIO.music.file);
  const fade = AUDIO.music.fadeSeconds * fps;
  return (
    <>
      {voice && (
        <Sequence from={Math.round(AUDIO.voiceover.offsetSeconds * fps)} layout="none">
          <Audio src={staticFile(AUDIO.voiceover.file)} volume={AUDIO.voiceover.volume} />
        </Sequence>
      )}
      {music && (
        <Audio
          src={staticFile(AUDIO.music.file)}
          loop
          volume={(f) =>
            interpolate(f, [0, fade, durationInFrames - fade, durationInFrames], [0, 1, 1, 0], {
              extrapolateLeft: "clamp",
              extrapolateRight: "clamp",
            }) * (voice ? AUDIO.music.duckedVolume : AUDIO.music.volume)
          }
        />
      )}
    </>
  );
};
