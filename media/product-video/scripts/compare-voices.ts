// `node --experimental-strip-types scripts/compare-voices.ts a.wav b.wav …` — one
// Gemini call hears every sample and ranks them for a product-video narration.
import { readFileSync } from "node:fs";
import { geminiKey } from "./gemini-env.ts";

const MODEL = process.env.LISTEN_MODEL ?? "gemini-3.1-pro-preview";
const files = process.argv.slice(2);
const parts = files.flatMap((f, i) => [
  { text: `Sample ${i + 1}: ${f.split("/").pop()}` },
  { inlineData: { mimeType: "audio/wav", data: readFileSync(f).toString("base64") } },
]);
const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
  method: "POST",
  headers: { "content-type": "application/json", "x-goog-api-key": geminiKey() },
  body: JSON.stringify({
    contents: [
      {
        parts: [
          ...parts,
          {
            text: "These are the same narration line in different synthetic voices, for a 60-second product video. Rank them best to worst for a warm, clear, natural, easy-to-listen-to narrator. For each: one line on warmth, clarity, naturalness, pacing and any artifacts. Then name the winner.",
          },
        ],
      },
    ],
  }),
});
const j = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[]; error?: { message: string } };
console.log(j.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ?? j.error?.message);
