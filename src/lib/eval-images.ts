import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { ToolRecord } from "./types";

const EVAL_PROMPT = `You are evaluating whether a product image matches a tool listing.

Tool name: {name}
Tool description: {description}

Look at the image and determine:
1. Does the image show the tool described above?
2. Is the image a reasonable product photo for this listing?

Respond with EXACTLY this JSON format (no markdown, no extra text):
{
  "match": true or false,
  "confidence": "high" or "medium" or "low",
  "image_shows": "brief description of what the image actually shows",
  "reasoning": "one sentence explaining your verdict"
}`;

export interface EvalResult {
  name: string;
  status: "PASS" | "FAIL" | "WARN" | "SKIP" | "ERROR";
  image_filename: string | null;
  eval?: {
    match: boolean;
    confidence: string;
    image_shows: string;
    reasoning: string;
  };
  reason?: string;
  filename_issue?: string;
}

interface ToolImageInfo {
  name: string;
  description: string;
  image_url: string | null;
  image_filename: string | null;
}

function getClient(): Anthropic {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });
}

async function downloadImage(url: string): Promise<{ base64: string; mediaType: string }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const contentType = res.headers.get("content-type") || "image/jpeg";
  const buffer = await res.arrayBuffer();
  return { base64: Buffer.from(buffer).toString("base64"), mediaType: contentType };
}

function parseEvalResponse(text: string): EvalResult["eval"] | null {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.split("\n").filter((l) => !l.trim().startsWith("```")).join("\n");
  }
  try { return JSON.parse(cleaned); } catch { return null; }
}

export function toolToImageInfo(tool: ToolRecord): ToolImageInfo {
  const img = tool.fields.image_attachments?.[0];
  return {
    name: tool.fields.name,
    description: tool.fields.description || "",
    image_url: img?.thumbnails?.large?.url || img?.url || null,
    image_filename: img?.filename || null,
  };
}

export async function evaluateImage(tool: ToolImageInfo): Promise<EvalResult> {
  if (!tool.image_url) {
    return { name: tool.name, status: "SKIP", image_filename: tool.image_filename, reason: "No image" };
  }

  let imgData: { base64: string; mediaType: string };
  try {
    imgData = await downloadImage(tool.image_url);
  } catch (e) {
    return { name: tool.name, status: "ERROR", image_filename: tool.image_filename, reason: `Download failed: ${e}` };
  }

  const client = getClient();
  const prompt = EVAL_PROMPT.replace("{name}", tool.name).replace("{description}", tool.description);

  try {
    const response = await client.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: imgData.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: imgData.base64 } },
          { type: "text", text: prompt },
        ],
      }],
    });

    const text = response.content[0].type === "text" ? response.content[0].text : "";
    const parsed = parseEvalResponse(text);

    if (!parsed || parsed.match === undefined) {
      return { name: tool.name, status: "ERROR", image_filename: tool.image_filename, reason: "Could not parse Claude response" };
    }

    const normalize = (s: string) => s.toLowerCase().replace(/[/_]/g, "").replace(/\s+/g, " ").trim();
    const fnStem = tool.image_filename ? tool.image_filename.replace(/\.[^.]+$/, "") : "";
    const filenameMismatch = fnStem && normalize(fnStem) !== normalize(tool.name);

    if (!parsed.match) {
      return { name: tool.name, status: "FAIL", image_filename: tool.image_filename, eval: parsed };
    } else if (filenameMismatch) {
      return { name: tool.name, status: "WARN", image_filename: tool.image_filename, eval: parsed, filename_issue: `expected ~'${tool.name}', got '${tool.image_filename}'` };
    } else {
      return { name: tool.name, status: "PASS", image_filename: tool.image_filename, eval: parsed };
    }
  } catch (e) {
    return { name: tool.name, status: "ERROR", image_filename: tool.image_filename, reason: `Claude API error: ${e}` };
  }
}
