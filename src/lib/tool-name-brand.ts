/**
 * "Does this display name say what the item is?" (display names amendment
 * 2026-09-25, tool display names spec §5.1).
 *
 * A dry run on the real inventory turned "HAKKO FX-888D" into "Hakko" and
 * "AOYUE Int 2703A+" into "Aoyue Int": the guard removed the part number and
 * left a brand. A card that says only "Makita" tells a student nothing, so a
 * display name that is **only a brand**, or a brand plus a fragment ("Int",
 * "Lab", "Pro"), is refused wherever a model's answer is guarded, and the
 * caller falls back to the brand plus a noun from the tool's category.
 *
 * The brand is not a column, so it is read off the long name: the leading run
 * of all-capitals words ("SPEAR & JACKSON", "RYOBI ONE+"), else the first word
 * ("Bofa", "iPad"), plus any brand the caller knows.
 *
 * Pure, client-safe and plain Node: no imports.
 */

/** Words that never say what an item is on their own: company suffixes, trims, fillers. */
const NON_DESCRIPTIVE = new Set([
  "int",
  "intl",
  "international",
  "inc",
  "co",
  "corp",
  "company",
  "ltd",
  "llc",
  "gmbh",
  "lab",
  "labs",
  "tools",
  "tool",
  "industries",
  "pro",
  "max",
  "mini",
  "plus",
  "one",
  "series",
  "edition",
  "new",
  "original",
  "the",
  "and",
  "of",
]);

/** Short words that do name a thing ("Stanley Saw", "Glue Gun", "Bit Set"). */
const SHORT_NOUNS = new Set(["saw", "gun", "kit", "set", "fan", "vac", "bit", "pen", "cnc", "pcb", "led", "vr", "ipad", "mat", "jig", "hub", "cam", "axe", "awl", "pot", "rod"]);

function words(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function bareWord(word: string): string {
  return word.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** A word of capitals only (and `&` / `+`), at least two letters: "RYOBI", "ONE+", "&". */
function isCapsWord(word: string): boolean {
  if (word === "&") return true;
  const letters = word.replace(/[^\p{L}]/gu, "");
  return letters.length >= 2 && !/\d/.test(word) && letters === letters.toUpperCase() && /^[\p{L}&+.'’-]+$/u.test(word);
}

/**
 * The brand's words, lower-cased and bare, read off `sourceName` (the long
 * name) plus `brand` when the caller knows it.
 */
export function brandWords(sourceName: string, brand?: string | null): Set<string> {
  const out = new Set<string>();
  for (const word of words(brand ?? "")) if (bareWord(word)) out.add(bareWord(word));
  const tokens = words(sourceName);
  const caps: string[] = [];
  for (const token of tokens) {
    if (!isCapsWord(token)) break;
    caps.push(token);
  }
  // "HP Sprout": a caps run of one short word is a brand too; "WEN", "SKIL".
  const run = caps.length > 0 && caps.length < tokens.length ? caps : tokens.length > 1 ? tokens.slice(0, 1) : [];
  for (const word of run) if (bareWord(word)) out.add(bareWord(word));
  return out;
}

/** The brand as a card should spell it: "HAKKO" → "Hakko", "SPEAR & JACKSON" → "Spear & Jackson"; "WEN", "HP" kept. */
export function brandLabel(sourceName: string, brand?: string | null): string {
  const given = words(brand ?? "");
  const tokens = given.length > 0 ? given : words(sourceName);
  const caps: string[] = [];
  for (const token of tokens) {
    if (!isCapsWord(token)) break;
    caps.push(token);
  }
  const run = given.length > 0 ? given : caps.length > 0 && caps.length < tokens.length ? caps : tokens.slice(0, 1);
  // A shouted word of four or more letters is title-cased; "WEN", "HP" and a
  // product line like "ONE+" are kept as written.
  return run
    .map((word) =>
      /^\p{Lu}{4,}$/u.test(word) ? word.charAt(0) + word.slice(1).toLowerCase() : word
    )
    .join(" ");
}

/**
 * True when `display` names only a brand: every word is a brand word, a
 * non-descriptive word ("Int", "Pro", "Lab") or a short letters-only fragment
 * that is not a known noun. A word with a digit is a model ("Dremel 3000",
 * "X2D", "Form 4") and says what the item is; so does any other word of four
 * or more letters that is not the brand's.
 *
 * `category` rescues a one-word name that the first-word rule would take for
 * a brand: "Oscilloscope" in "Electronics > Oscilloscope" is a noun.
 */
export function isBareBrand(
  display: string,
  context: { sourceName: string; brand?: string | null; category?: string | null }
): boolean {
  const displayWords = words(display).map(bareWord).filter(Boolean);
  if (displayWords.length === 0) return true;
  const brand = brandWords(context.sourceName, context.brand);
  const category = (context.category ?? "").toLowerCase();
  return !displayWords.some((word) => {
    if (/\d/.test(word)) return true;
    if (brand.has(word)) return category.includes(word) && !context.brand;
    if (NON_DESCRIPTIVE.has(word)) return false;
    return word.length >= 4 || SHORT_NOUNS.has(word);
  });
}

/** Category names that are an activity, not a thing: the thing a tool in them is. */
const CATEGORY_NOUNS: Record<string, string | null> = {
  soldering: "Soldering Station",
  "dust extraction": "Dust Extractor",
  "fume extraction": "Fume Extractor",
  "general hand tool": "Hand Tool",
  "post-processing": null,
  accessory: null,
  ppe: null,
  "test equipment": null,
  workstation: "Workstation",
  waterjet: "Waterjet Cutter",
};

/**
 * What a tool in `category` is, as a noun for a card: "Router" → "Router",
 * "Soldering" → "Soldering Station", "Drill/Driver" → "Drill", "Dust
 * Extraction" → "Dust Extractor". Null for a category that names no thing
 * ("Accessory", "Post-Processing") — then there is no fallback noun.
 */
export function categoryNoun(category: string | null | undefined): string | null {
  const name = (category ?? "").replace(/\s+/g, " ").trim();
  if (!name) return null;
  const key = name.toLowerCase();
  if (key in CATEGORY_NOUNS) return CATEGORY_NOUNS[key];
  const first = name.split("/")[0].trim();
  const firstKey = first.toLowerCase();
  if (firstKey in CATEGORY_NOUNS) return CATEGORY_NOUNS[firstKey];
  // "Sewing", "Scanning": an activity is not a thing to put on a card.
  if (/ing$/i.test(first)) return null;
  return first;
}
