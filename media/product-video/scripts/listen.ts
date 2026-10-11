// `node --experimental-strip-types scripts/listen.ts <file.wav> [...]` — has a
// Gemini model transcribe each clip and judge its delivery, as a check on TTS
// output (did it speak only the script? how natural is the read?).
import { readFileSync } from "node:fs";
import { geminiKey } from "./gemini-env.ts";

const MODEL = process.env.LISTEN_MODEL ?? "gemini-2.5-flash";
for (const file of process.argv.slice(2)) {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            { inlineData: { mimeType: "audio/wav", data: readFileSync(file).toString("base64") } },
            {
              text: "Transcribe this narration exactly, then on new lines rate 1-10: naturalness, warmth, clarity, pacing (too fast/slow?), and note any artifacts, long pauses, mispronunciations or odd emphasis. Be terse and critical.",
            },
          ],
        },
      ],
    }),
  });
  const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message: string } };
  console.log(`## ${file.split("/").pop()}\n${j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? j.error?.message}\n`);
}
