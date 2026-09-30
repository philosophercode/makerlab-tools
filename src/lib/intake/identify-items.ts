import type { IdentifyConfidence } from "../db/schema/vocabulary.ts";
import { normalizeToolName } from "../data/duplicates.ts";
import { IMPORT_MAX_QUANTITY } from "../import/limits.ts";
import { parseLine } from "../import/line-list.ts";

/**
 * Many items at once (data platform spec amendment "Many items at once"): what
 * code does to `identify_tools`' items before any row is written.
 *
 * The model does the seeing — every distinct object in every photo, and every
 * thing in a typed list — and hands over one entry per object. Code then makes
 * the batch honest about three things a model gets wrong often enough to
 * matter:
 *
 * - **A count left in the name** — "two Ryobi batteries", "3x Prusa MK4",
 *   "Heat gun (2)" — becomes the item's quantity (units at approval), and the
 *   name loses it ({@link quantityFromName}).
 * - **The same object twice** — one entry per photo of one drill, or a list
 *   that names it twice — becomes one item with all of its photos
 *   ({@link mergeIdentifiedItems}). Two entries with different serial numbers
 *   are two units of one tool, never merged away.
 * - **Confidence** is ranked so a merge keeps the surest reading.
 *
 * Pure: no database, no network. The duplicate check against the inventory
 * runs afterwards, in `createPendingBatch`, as it always did.
 */

/** One item as `identify_tools` hands it over, after its schema. */
export interface IdentifiedItem {
  name: string;
  brand?: string;
  categoryHint?: string;
  locationHint?: string;
  serialNumber?: string;
  attachmentIds: string[];
  quantity?: number;
  confidence?: IdentifyConfidence;
  seenIn?: string;
}

/** An item after the merge: a quantity always, and every serial that named a unit. */
export interface MergedItem extends Omit<IdentifiedItem, "quantity"> {
  quantity: number;
  /** Serials beyond the first, when entries with different serials were merged. */
  extraSerials: string[];
}

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  "a pair of": 2,
  "pair of": 2,
  "a couple of": 2,
  "a couple": 2,
  "a dozen": 12,
};

/**
 * A number followed by one of these is a size, not a count: "10 inch table
 * saw", "12 V drill", "3 mm nozzle".
 */
const MEASURE_WORDS =
  /^(?:inch(?:es)?|in\b|"|mm|cm|m\b|ft|feet|foot|oz|lb|lbs|kg|g\b|v\b|volts?|w\b|watts?|amps?|a\b|ah|l\b|liters?|litres?|gal|gallons?|speed|piece\b|pc\b|d\b)/i;

/**
 * The count a name carries, and the name without it. "two Ryobi batteries" →
 * 2, "Ryobi batteries"; "3x Prusa MK4" → 3; "Heat gun x2" → 2; "10 inch table
 * saw" → no count (a size). A count of 1 or over the import cap is ignored:
 * the name is kept as it was.
 */
export function quantityFromName(name: string): { name: string; quantity: number | null } {
  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  for (const [word, n] of Object.entries(NUMBER_WORDS).sort((a, b) => b[0].length - a[0].length)) {
    if (lower.startsWith(`${word} `)) {
      const rest = trimmed.slice(word.length).trim();
      if (rest && !MEASURE_WORDS.test(rest)) return { name: rest, quantity: n };
    }
  }

  // "2 Ryobi batteries": a bare leading number, unless a measure follows it.
  const bare = trimmed.match(/^(\d{1,2})\s+(.+)$/);
  if (bare && !MEASURE_WORDS.test(bare[2])) {
    const n = Number(bare[1]);
    if (n >= 2 && n <= IMPORT_MAX_QUANTITY) return { name: bare[2].trim(), quantity: n };
  }

  // "3x Name", "Name x3", "Name (3)", "Name, qty 3" — the import's own rules.
  const parsed = parseLine(trimmed);
  const count = Number(parsed?.quantity);
  if (parsed?.name && Number.isInteger(count) && count >= 2 && count <= IMPORT_MAX_QUANTITY && parsed.name !== trimmed) {
    return { name: parsed.name, quantity: count };
  }
  return { name: trimmed, quantity: null };
}

const CONFIDENCE_RANK: Record<IdentifyConfidence, number> = { sure: 2, likely: 1, unsure: 0 };

/** The surer of two readings; an absent one counts as `likely`. */
function surer(a: IdentifyConfidence | undefined, b: IdentifyConfidence | undefined): IdentifyConfidence {
  const x = a ?? "likely";
  const y = b ?? "likely";
  return CONFIDENCE_RANK[x] >= CONFIDENCE_RANK[y] ? x : y;
}

function clampQuantity(n: number | undefined): number {
  if (n === undefined || !Number.isFinite(n)) return 1;
  return Math.min(IMPORT_MAX_QUANTITY, Math.max(1, Math.floor(n)));
}

/**
 * One item per distinct object, in the order the model gave them.
 *
 * Entries whose name and brand normalize alike (the duplicate check's own
 * normalization) are the same object seen twice — two photos of one drill —
 * and become one item: every photo, the surer confidence, the hints the first
 * entry lacked, the places it was seen joined. The quantity is the larger
 * of the two, since "the same drill in two photos" is still one drill; but
 * when both entries carry **different serial numbers** they are two machines,
 * so the quantity covers every serial and the extra serials are kept.
 *
 * An `unsure` item — a suspected object the model could not name — is never
 * merged: two unnamed "cordless drill"s may well be two drills.
 */
export function mergeIdentifiedItems(items: readonly IdentifiedItem[]): { items: MergedItem[]; merged: number } {
  const out: MergedItem[] = [];
  const byKey = new Map<string, MergedItem>();
  let merged = 0;

  for (const raw of items) {
    const counted = quantityFromName(raw.name);
    const name = counted.name;
    const quantity = clampQuantity(raw.quantity !== undefined && raw.quantity > 1 ? raw.quantity : (counted.quantity ?? raw.quantity));
    const item: MergedItem = {
      brand: raw.brand,
      categoryHint: raw.categoryHint,
      locationHint: raw.locationHint,
      serialNumber: raw.serialNumber,
      confidence: raw.confidence,
      seenIn: raw.seenIn,
      name,
      quantity,
      attachmentIds: [...new Set(raw.attachmentIds)],
      extraSerials: [],
    };

    const key = normalizeToolName(name, raw.brand);
    const existing = raw.confidence === "unsure" || !key ? undefined : byKey.get(key);
    if (!existing) {
      out.push(item);
      if (raw.confidence !== "unsure" && key) byKey.set(key, item);
      continue;
    }

    merged += 1;
    existing.attachmentIds = [...new Set([...existing.attachmentIds, ...item.attachmentIds])];
    existing.confidence = surer(existing.confidence, item.confidence);
    existing.brand ??= item.brand;
    existing.categoryHint ??= item.categoryHint;
    existing.locationHint ??= item.locationHint;
    if (item.seenIn && item.seenIn !== existing.seenIn) {
      existing.seenIn = existing.seenIn ? `${existing.seenIn}; ${item.seenIn}`.slice(0, 200) : item.seenIn;
    }

    const serials = [existing.serialNumber, ...existing.extraSerials].filter((serial): serial is string => Boolean(serial));
    const incoming = item.serialNumber;
    if (incoming && serials.length > 0 && !serials.includes(incoming)) {
      // Two plates, two machines: units for both, however many each entry said.
      existing.extraSerials.push(incoming);
      existing.quantity = clampQuantity(Math.max(existing.quantity + item.quantity, serials.length + 1));
    } else {
      // The same object seen again (perhaps this photo shows its plate).
      existing.serialNumber ??= incoming;
      existing.quantity = clampQuantity(Math.max(existing.quantity, item.quantity));
    }
  }
  return { items: out, merged };
}
