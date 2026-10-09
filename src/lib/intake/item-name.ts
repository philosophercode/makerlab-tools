/**
 * Whether a pending item's name says what the item is (data platform spec
 * amendment "No empty items", 2026-10-07).
 *
 * The owner typed "I'd like to add new equipment to the inventory." and the
 * assistant recorded a row called "Equipment not specified", which then sat in
 * the Add equipment queue. A name like that is a placeholder, not an item:
 * nothing can be researched, approved or found from it. Every way a pending
 * item is made or renamed asks this one rule first — the chat's
 * `identify_tools`, `createPendingBatch` and `updatePendingTool` underneath
 * every route and action, an import's rows, MCP's `create_tool` — and a
 * placeholder is refused, never stored.
 *
 * **The rule.** A name is refused when it is empty or whitespace, or when it
 * has **no specific word**: every word in it is a generic one —
 * "equipment", "item", "tool", "unknown", "not specified", "n/a", "tbd",
 * "untitled", "new" and the like ({@link GENERIC_WORDS}), filler ("the",
 * "to", "add"), a lone letter or a bare number. Case, accents and punctuation
 * are ignored. One specific word is enough: "Cordless drill, brand not
 * visible", "3D printer", "Makita" and "Bambu Lab X1-Carbon" all pass — the
 * prompt asks for a plain descriptive name for an item the model can see but
 * not name, and that is a name.
 *
 * Pure, no imports: client code, step code and scripts all load it.
 */

/** Why a name was refused. */
export type ItemNameProblem = "empty" | "placeholder";

/**
 * Words that say nothing about which item this is. A name made only of these
 * (and of lone letters and bare numbers) is a placeholder.
 *
 * English first, then the generic words of the Latin-script locales the chat
 * speaks (Spanish, French, Portuguese, Turkish), accents removed — model names
 * and makes are rarely written in other scripts.
 */
export const GENERIC_WORDS: ReadonlySet<string> = new Set([
  // What any item is.
  "equipment", "equipments", "tool", "tools", "item", "items", "thing", "things", "stuff", "object", "objects",
  "product", "products", "device", "devices", "machine", "machines", "machinery", "unit", "units", "gear",
  "hardware", "apparatus", "instrument", "instruments", "appliance", "appliances", "kit", "kits", "part", "parts",
  "accessory", "accessories", "supply", "supplies", "material", "materials", "asset", "assets", "piece", "pieces",
  "entry", "entries", "record", "records", "inventory", "catalog", "catalogue", "lab", "makerlab", "makerspace",
  "shop", "workshop",
  // Placeholders.
  "unknown", "unspecified", "specified", "unidentified", "identified", "unnamed", "named", "untitled", "titled",
  "unlabeled", "unlabelled", "labeled", "labelled", "undetermined", "determined", "undecided", "decided",
  "unconfirmed", "confirmed", "known", "given", "provided", "listed", "mentioned", "stated", "visible", "readable",
  "legible", "clear", "available", "pending", "placeholder", "dummy", "sample", "example", "test", "testing",
  "blank", "empty", "none", "null", "nil", "undefined", "nan", "na", "tba", "tbc", "tbd", "todo", "misc",
  "miscellaneous", "various", "assorted", "general", "generic", "random", "other", "others", "another", "etc",
  "something", "anything", "whatever", "sure", "unsure", "check", "confirm", "see", "later", "yet",
  // Words about a name rather than a name.
  "name", "names", "title", "label", "description", "details", "detail", "info", "information", "model", "make",
  "brand", "type", "kind", "sort", "variety", "version", "number", "no", "not", "without",
  // Filler.
  "a", "an", "the", "of", "for", "to", "and", "or", "in", "on", "at", "with", "from", "by", "my", "our", "your",
  "their", "this", "that", "these", "those", "some", "any", "more", "new", "old", "i", "d", "ll", "m", "s", "ve",
  "re", "we", "you", "it", "its", "is", "are", "was", "be", "been", "will", "would", "like", "want", "wants",
  "need", "needs", "please", "add", "adding", "added", "create", "register", "enter", "put", "get", "let", "me",
  "us", "here", "there", "just", "also", "one", "two", "three", "first", "second", "third",
  // Spanish, French, Portuguese, Turkish.
  "equipo", "equipos", "herramienta", "herramientas", "articulo", "cosa", "objeto", "desconocido", "nuevo",
  "nueva", "sin", "especificar", "especificado", "nombre", "equipement", "outil", "outils", "objet", "article",
  "chose", "inconnu", "nouveau", "nouvel", "non", "specifie", "sans", "nom", "equipamento", "ferramenta", "coisa",
  "desconhecido", "novo", "sem", "nome", "ekipman", "alet", "oge", "esya", "bilinmeyen", "yeni", "belirtilmemis",
]);

/** The words of a name: lowercased, accents removed, split on anything that is not a letter or digit. */
export function nameWords(name: string): string[] {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** A word that says something: not generic, has a letter, and is more than one Latin letter. */
function isSpecificWord(word: string): boolean {
  if (GENERIC_WORDS.has(word)) return false;
  if (!/\p{L}/u.test(word)) return false;
  return !/^[a-z]$/.test(word);
}

/** Why `name` cannot be a pending item's name, or null when it can. */
export function itemNameProblem(name: string | null | undefined): ItemNameProblem | null {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "empty";
  return nameWords(trimmed).some(isSpecificWord) ? null : "placeholder";
}

/** True for an empty name or a placeholder — what every intake write refuses. */
export function isPlaceholderItemName(name: string | null | undefined): boolean {
  return itemNameProblem(name) !== null;
}
