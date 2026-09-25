/**
 * How the ⌘K palette matches what was typed (UI system spec §7.5).
 *
 * Every word typed must appear in the item's keywords — a surface's title, a
 * tool's display name, official name and slug — so "form 4" finds the Form 4
 * and "speedy" finds a tool whose display name is "Trotec laser" but whose
 * official name is "Trotec Speedy 400". A keyword that *starts* with the
 * query ranks above one that merely contains it. Case, accents and spacing are
 * ignored. Deliberately not fuzzy: a palette that jumps to the wrong machine
 * because three letters happened to appear in order is worse than one that
 * says nothing matched.
 *
 * Returns cmdk's score: 0 hides the item, higher sorts first.
 */
export function paletteScore(search: string, keywords: readonly string[]): number {
  const words = normalise(search).split(" ").filter(Boolean);
  if (words.length === 0) return 1;
  const haystacks = keywords.map(normalise).filter(Boolean);
  if (haystacks.length === 0) return 0;
  const joined = haystacks.join(" ");
  if (!words.every((word) => joined.includes(word))) return 0;
  const query = words.join(" ");
  if (haystacks.some((text) => text === query)) return 1;
  if (haystacks.some((text) => text.startsWith(query))) return 0.8;
  if (haystacks.some((text) => text.split(" ").some((part) => part.startsWith(words[0])))) return 0.6;
  return 0.4;
}

function normalise(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}
