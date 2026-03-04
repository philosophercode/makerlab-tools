const DEFAULT_MODELS = [
  // Highest quality model — preferred default.
  "gemini-3-pro-image-preview",
  // Fast fallback if pro times out.
  "gemini-2.5-flash-image",
];

function getApiKey(): string | null {
  return (
    process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
    process.env.GOOGLE_API_KEY ||
    null
  );
}

function getModels(): string[] {
  const configured = process.env.GEMINI_IMAGE_MODELS
    ?.split(",")
    .map((m) => m.trim())
    .filter(Boolean);
  if (configured && configured.length > 0) return configured;
  const single = process.env.GEMINI_IMAGE_MODEL?.trim();
  if (single) return [single];
  return DEFAULT_MODELS;
}

interface GeminiImageResult {
  imageBase64: string;
  mimeType: string;
  text?: string;
  model: string;
}

export async function generateImage(
  prompt: string,
): Promise<GeminiImageResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Gemini API key is not configured (set GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY)");
  }

  const models = getModels();
  const failures: string[] = [];

  for (const model of models) {
    const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    let res: Response;
    try {
      res = await fetch(`${apiUrl}?key=${apiKey}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: AbortSignal.timeout(30_000),
        body: JSON.stringify({
          systemInstruction: {
            parts: [{
              text: "You are a product photography image generator. CRITICAL RULE: The COMPLETE object must be fully visible in frame with generous padding on ALL sides — top, bottom, left, right. Never crop or cut off ANY edge of the object. Zoom out enough that there is empty background space surrounding the entire item. Use a slightly elevated 3/4 angle so the full 3D shape is clear. The object should occupy roughly 60% of the frame, centered.",
            }],
          },
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            responseModalities: ["TEXT", "IMAGE"],
          },
        }),
      });
    } catch (err) {
      // Timeout or network error — try next model.
      const reason = err instanceof Error ? err.message : "fetch failed";
      failures.push(`${model}: ${reason}`);
      continue;
    }

    if (!res.ok) {
      const body = await res.text();
      failures.push(`${model}: ${res.status}`);
      if (res.status === 401 || res.status === 403) {
        throw new Error(`Gemini authentication failed (${res.status})`);
      }
      if (res.status === 429) {
        throw new Error("Gemini is rate-limited right now. Please try again shortly.");
      }
      continue;
    }

    const data = await res.json();
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts || parts.length === 0) {
      failures.push(`${model}: empty response`);
      continue;
    }

    let imageBase64 = "";
    let mimeType = "image/png";
    let text: string | undefined;

    for (const part of parts) {
      if (part.inlineData) {
        imageBase64 = part.inlineData.data;
        mimeType = part.inlineData.mimeType || "image/png";
      } else if (part.text) {
        text = part.text;
      }
    }

    if (!imageBase64) {
      failures.push(`${model}: no image data`);
      continue;
    }

    return { imageBase64, mimeType, text, model };
  }

  throw new Error(
    `Image generation failed for all configured Gemini models (${failures.join(", ") || "unknown error"})`
  );
}
