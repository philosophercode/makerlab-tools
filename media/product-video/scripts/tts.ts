// AI narration with Gemini TTS, one clip per script line.
//
//   npm run tts -- samples                 3 voices reading the first line → out/voice-samples/
//   npm run tts -- full [--voice Name]     every line → public/vo/<id>.wav (+ durations.json)
//
// Reads GEMINI_API_KEY from the environment or the repo's .env.local (never printed).
// Each clip is loudness-normalised to about -16 LUFS with ffmpeg.
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { SCRIPT } from "../src/script.ts";
import { geminiKey } from "./gemini-env.ts";

export const TTS_MODEL = process.env.TTS_MODEL ?? "gemini-2.5-pro-preview-tts";
export const TTS_VOICE = "Sulafat";
// Directions and transcript in separate sections; only the transcript is spoken.
// (This model reads a "Say …:" prefix aloud and rejects a system instruction.)
const STYLE = (text: string) => `### DIRECTOR'S NOTES
Style: the narrator of a short product video. Warm, friendly and confident, natural American English, no hype.
Pace: calm and unhurried, with relaxed pauses at punctuation. Statements end on a settled, downward note, not as questions.

### TRANSCRIPT
${text}`;
// The 2.5 TTS models take directions as a "Say …:" prefix (documented behaviour).
const SAY = "Say warmly and clearly, like a friendly, confident product-video narrator, at a calm, unhurried pace";
// TTS_PROMPT=plain sends the line alone; =say the prefix; =notes the sections.
function prompt(text: string): string {
  const kind = process.env.TTS_PROMPT ?? (TTS_MODEL.startsWith("gemini-2.5") ? "say" : "notes");
  return kind === "plain" ? text : kind === "say" ? `${SAY}: ${text}` : STYLE(text);
}
const SAMPLE_VOICES = (process.env.TTS_SAMPLE_VOICES ?? "Sulafat,Achird,Iapetus").split(",");
const SAMPLE_TAG = process.env.TTS_SAMPLE_TAG ?? "";

const root = new URL("..", import.meta.url).pathname;
const args = process.argv.slice(2);
const mode = args[0] ?? "full";
const voiceArg = args.indexOf("--voice") >= 0 ? args[args.indexOf("--voice") + 1] : TTS_VOICE;

async function speak(text: string, voice: string): Promise<Buffer> {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${TTS_MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt(text) }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      }),
    });
    const j = (await res.json()) as {
      candidates?: { content?: { parts?: { inlineData?: { data: string; mimeType: string } }[] } }[];
      error?: { message: string };
    };
    const data = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData)?.inlineData?.data;
    if (res.ok && data) return Buffer.from(data, "base64");
    if (attempt >= 4) throw new Error(`TTS failed (${res.status}): ${j.error?.message ?? "no audio"}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

/** Raw 24 kHz 16-bit mono PCM → normalised WAV, silence trimmed at both ends. */
function toWav(pcm: Buffer, out: string): void {
  const raw = `${out}.pcm`;
  writeFileSync(raw, pcm);
  execFileSync("ffmpeg", [
    "-y", "-loglevel", "error",
    "-f", "s16le", "-ar", "24000", "-ac", "1", "-i", raw,
    "-af",
    "silenceremove=start_periods=1:start_threshold=-50dB,areverse,silenceremove=start_periods=1:start_threshold=-50dB,areverse,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000",
    "-ar", "48000",
    out,
  ]);
  execFileSync("mv", [raw, `/tmp/${Date.now()}-tts.pcm`]);
}

const seconds = (file: string) =>
  Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]).toString().trim());

if (mode === "samples") {
  const dir = join(root, "out", "voice-samples");
  mkdirSync(dir, { recursive: true });
  for (const v of SAMPLE_VOICES) {
    const file = join(dir, `${SCRIPT[0].id}-${v}${SAMPLE_TAG}.wav`);
    toWav(await speak(SCRIPT[0].text, v), file);
    console.log(`${v}: ${seconds(file).toFixed(2)} s → ${file}`);
  }
} else {
  const dir = join(root, "public", "vo");
  mkdirSync(dir, { recursive: true });
  const durations: Record<string, number> = {};
  for (const line of SCRIPT) {
    const file = join(dir, `${line.id}.wav`);
    toWav(await speak(line.text, voiceArg), file);
    durations[line.id] = Number(seconds(file).toFixed(3));
    console.log(`${line.id}: ${durations[line.id]} s`);
  }
  writeFileSync(join(dir, "durations.json"), JSON.stringify({ model: TTS_MODEL, voice: voiceArg, durations }, null, 2) + "\n");
}
