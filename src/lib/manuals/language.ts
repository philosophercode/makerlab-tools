/**
 * Whether a manual passage is in English: a few common words counted, no model
 * and no dictionary. Multilingual manuals repeat the same text in French,
 * Spanish, German and more; an eval question written from one of those
 * sections expects a page the chat, answering from the English section, never
 * cites (manual text spec amendment "English passages only").
 */

/** Common English words that are not also common words in the other languages below. */
const ENGLISH = new Set(
  "the and of to is are be with for this that your you not when before after from it or can will should if use into these those must which while".split(" ")
);

/** Common French, Spanish, Portuguese, Italian, German and Dutch words that are not English words. */
const OTHER = new Set(
  (
    "le la les des du est et pour avec une dans sur que pas vous ne sont ou cette " +
    "el los las del y para con una por que se su al es como este esta " +
    "os da em com não uma pelo pela " +
    "il di che per della sono gli " +
    "der die das und mit für ist nicht sie ein eine zu den von werden bei auf " +
    "het een van voor niet zijn met"
  ).split(" ")
);

/** Letters from scripts English is not written in: Cyrillic, Greek, Arabic, Hebrew, CJK, Thai, Korean. */
const NON_LATIN = /[Ͱ-ϿЀ-ӿ֐-ۿ฀-๿぀-ヿ㐀-鿿가-힯]/g;

export function looksEnglish(text: string): boolean {
  const letters = text.replace(/[^\p{L}]/gu, "").length;
  if (letters === 0) return false;
  if ((text.match(NON_LATIN)?.length ?? 0) > letters * 0.2) return false;
  const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
  let english = 0;
  let other = 0;
  for (const word of words) {
    if (ENGLISH.has(word)) english += 1;
    else if (OTHER.has(word)) other += 1;
  }
  return english >= 3 && english >= 2 * other;
}
