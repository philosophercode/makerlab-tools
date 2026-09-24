import { z } from "zod";
import { IMPORT_CHUNK_CHARS, IMPORT_DOCUMENT_MAX_CHARS } from "./limits.ts";
import type { RawImportItem } from "./types.ts";

/**
 * The extractor's two pure halves (bulk intake spec §3.2): cutting a document
 * into model-sized chunks, and reading the model's answer.
 *
 * **The answer is data from a model that read untrusted text**, so it is read
 * strictly in shape and leniently in content: anything that is not
 * `{ "items": [...] }` JSON is refused (the chunk fails and says so), each
 * item without a usable name is dropped, every string is capped, and at most
 * {@link MAX_ITEMS_PER_CHUNK} items come back from one chunk. Nothing it says
 * becomes anything but a pending row a person reviews.
 *
 * Plain Node, client-safe, no I/O.
 */

/** The most items one chunk may yield — a runaway answer is cut, not trusted. */
export const MAX_ITEMS_PER_CHUNK = 200;

const MAX_FIELD = 200;
const MAX_NOTES = 1000;
const MAX_LIST = 10;

/** Thrown when the answer is not the JSON object asked for. */
export class ExtractOutputError extends Error {
  override name = "ExtractOutputError";
}

const text = (max: number) =>
  z
    .unknown()
    .transform((value) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : typeof value === "number" ? String(value) : null))
    .transform((value) => value || null);

const stringList = z
  .unknown()
  .transform((value) =>
    (Array.isArray(value) ? value : typeof value === "string" ? [value] : [])
      .filter((entry): entry is string => typeof entry === "string")
      .map((entry) => entry.trim().slice(0, 2048))
      .filter(Boolean)
      .slice(0, MAX_LIST)
  );

const itemSchema = z.object({
  name: text(MAX_FIELD),
  brand: text(MAX_FIELD).optional(),
  model: text(MAX_FIELD).optional(),
  quantity: z
    .unknown()
    .transform((value) => (typeof value === "number" || typeof value === "string" ? value : null))
    .optional(),
  serials: stringList.optional(),
  category: text(MAX_FIELD).optional(),
  location: text(MAX_FIELD).optional(),
  notes: text(MAX_NOTES).optional(),
  links: stringList.optional(),
  labDocs: stringList.optional(),
});

/**
 * The items in a model's answer, as raw items for `normalizeImportItems`.
 * Tolerates a fenced ```json block; refuses anything else.
 */
export function parseExtractOutput(answer: string): RawImportItem[] {
  const json = unwrapJson(answer);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ExtractOutputError("the answer was not JSON");
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { items?: unknown }).items)) {
    throw new ExtractOutputError('the answer had no "items" list');
  }
  const items: RawImportItem[] = [];
  for (const entry of (parsed as { items: unknown[] }).items.slice(0, MAX_ITEMS_PER_CHUNK)) {
    if (typeof entry !== "object" || entry === null) continue;
    const result = itemSchema.safeParse(entry);
    if (!result.success) continue;
    const item = result.data;
    if (!item.name && !item.model) continue;
    items.push({
      name: item.name,
      brand: item.brand ?? null,
      model: item.model ?? null,
      quantity: item.quantity ?? null,
      serials: item.serials ?? [],
      category: item.category ?? null,
      location: item.location ?? null,
      notes: item.notes ?? null,
      links: item.links ?? [],
      labDocs: item.labDocs ?? [],
    });
  }
  return items;
}

/**
 * The document in chunks of about {@link IMPORT_CHUNK_CHARS}, cut at a line
 * break where there is one in the second half of the window (so an entry is
 * rarely split), never longer than the window. The text is first capped at
 * {@link IMPORT_DOCUMENT_MAX_CHARS}; whether it was is `truncated`.
 */
export function chunkDocument(
  source: string,
  size: number = IMPORT_CHUNK_CHARS
): { chunks: string[]; truncated: boolean } {
  const truncated = source.length > IMPORT_DOCUMENT_MAX_CHARS;
  const text = source.slice(0, IMPORT_DOCUMENT_MAX_CHARS);
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const breakAt = text.lastIndexOf("\n", end);
      if (breakAt > start + size / 2) end = breakAt + 1;
    }
    const chunk = text.slice(start, end);
    if (chunk.trim()) chunks.push(chunk);
    start = end;
  }
  return { chunks, truncated };
}

function unwrapJson(answer: string): string {
  const trimmed = answer.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1];
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  return first >= 0 && last > first ? trimmed.slice(first, last + 1) : trimmed;
}
