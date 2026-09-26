/**
 * Is this page English? (gateway spec amendment 2026-09-26 "English resources
 * only".)
 *
 * The owner's rule: "when finding a document or resource, the requirement is
 * to be in English. It needs to be an English website or manual." A
 * multilingual manual that includes English counts as English.
 *
 * Judged in code, from what research already has — never a model call:
 *
 * - {@link urlLanguages} — the URL's own locale (a path segment, a subdomain,
 *   a query value, a PDF file name's language tokens);
 * - {@link declaredLanguage} — the page's `<html lang>`;
 * - {@link textLanguage} — the text itself, in windows, by script and by stop
 *   words;
 * - {@link titleLanguage} — a link title, for when there is no text.
 *
 * {@link pageLanguage} combines them, strongest first: decisive text, then the
 * declared language, then the URL. "unknown" is never a reason to drop
 * anything — the rule drops a page only on evidence.
 *
 * Pure, no imports. Plain Node: step code imports this.
 */

export type LanguageVerdict = "english" | "not_english" | "unknown";

export interface LanguageJudgement {
  verdict: LanguageVerdict;
  /** The primary language subtag decided on ("en", "de", "ja"), or null when unknown. */
  lang: string | null;
  /** Which signal decided it. */
  basis: "text" | "declared" | "url" | "title" | "none";
}

const UNKNOWN: LanguageJudgement = { verdict: "unknown", lang: null, basis: "none" };

/** ISO 639-1 codes read as a language when they stand alone in a URL. */
const LANGUAGE_CODES = new Set([
  "en", "de", "fr", "es", "it", "nl", "pt", "pl", "sv", "da", "nb", "nn", "no", "fi", "cs", "sk", "hu", "ro",
  "bg", "hr", "sl", "sr", "el", "tr", "ru", "uk", "ja", "zh", "ko", "ar", "he", "th", "vi", "id", "ms", "lt",
  "lv", "et", "ca", "eu", "gl", "fa", "hi",
]);

/**
 * Codes that are too often something else to be read alone: a country
 * (`uk`, `ca`), an English word or common abbreviation (`id`, `no`), so a bare
 * `/uk/` or `id.` says nothing. With a region (`uk-ua`, `ca-es`) they are read.
 */
const AMBIGUOUS_BARE = new Set(["uk", "ca", "id", "no", "ms", "hi", "et", "eu"]);

/** In a file name, English words and short tokens that are also language codes. */
const AMBIGUOUS_IN_FILE = new Set([...AMBIGUOUS_BARE, "it", "is", "da", "el", "he", "sl", "th", "fa", "vi", "ko", "ar", "cs"]);

/** Query parameters that carry a locale. */
const LOCALE_PARAMS = ["lang", "language", "locale", "hl", "lng", "lc"];

/** `de`, `de-de`, `de_DE`, `zh-hans`, `pt-br` — a locale-shaped path segment. */
const LOCALE_SEGMENT = /^([a-z]{2})(?:[-_]([a-z]{2}|hans|hant|latn|cyrl))?$/i;

export interface UrlLanguages {
  /** Primary subtags, each once, in the order found. */
  langs: string[];
  where: "path" | "subdomain" | "query" | "file";
}

/**
 * The languages a URL names for itself, or null when it names none. A country
 * top-level domain is not read: German brands serve English under `.de/en/`.
 */
export function urlLanguages(raw: string): UrlLanguages | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  // The query first: it is explicit.
  for (const param of LOCALE_PARAMS) {
    const value = url.searchParams.get(param);
    const lang = value ? localeLanguage(value.trim(), true) : null;
    if (lang) return { langs: [lang], where: "query" };
  }

  // A locale segment among the first two path segments (`/de-de/…`, `/intl/ja/…`).
  const segments = decodeSafe(url.pathname).split("/").filter(Boolean);
  for (const segment of segments.slice(0, 2)) {
    const lang = localeLanguage(segment, false);
    if (lang) return { langs: [lang], where: "path" };
  }

  // A language subdomain (`de.example.com`), never the registrable name itself.
  const labels = url.hostname.toLowerCase().split(".");
  if (labels.length > 2) {
    const lang = localeLanguage(labels[0], false);
    if (lang) return { langs: [lang], where: "subdomain" };
  }

  // A PDF's file name: `…_DE.pdf`, `manual_en_de_fr.pdf`.
  const file = segments[segments.length - 1] ?? "";
  if (/\.pdf$/i.test(file)) {
    const tokens = file
      .replace(/\.pdf$/i, "")
      .split(/[-_.\s()[\]]+/)
      .map((token) => token.toLowerCase())
      .filter(Boolean);
    const langs: string[] = [];
    for (const token of tokens) {
      if (token.length !== 2 || !LANGUAGE_CODES.has(token)) continue;
      // An ambiguous token counts only beside an unambiguous one (`en_de_it` is three languages).
      if (!langs.includes(token)) langs.push(token);
    }
    const sure = langs.filter((lang) => !AMBIGUOUS_IN_FILE.has(lang));
    if (sure.length > 0) return { langs, where: "file" };
  }
  return null;
}

/** The language of a locale string (`de`, `de-DE`, `zh_hans`), or null. */
function localeLanguage(value: string, explicit: boolean): string | null {
  const match = LOCALE_SEGMENT.exec(value);
  if (!match) return null;
  const lang = match[1].toLowerCase();
  if (!LANGUAGE_CODES.has(lang)) return null;
  // A bare ambiguous code is read only where the context says it is a locale (a `lang=` value).
  if (!match[2] && !explicit && AMBIGUOUS_BARE.has(lang)) return null;
  return normaliseLang(lang);
}

/** `nb` / `nn` are Norwegian; everything else as it is. */
function normaliseLang(lang: string): string {
  return lang === "nb" || lang === "nn" ? "no" : lang;
}

/** A URL's verdict alone. */
export function urlLanguage(raw: string): LanguageJudgement {
  const found = urlLanguages(raw);
  if (!found) return UNKNOWN;
  if (found.langs.includes("en")) return { verdict: "english", lang: "en", basis: "url" };
  return { verdict: "not_english", lang: found.langs[0], basis: "url" };
}

/** A declared language tag (`en-US`, `de`), as a verdict. */
export function declaredLanguage(tag: string | null | undefined): LanguageJudgement {
  const primary = (tag ?? "").trim().toLowerCase().split(/[-_]/)[0];
  if (!/^[a-z]{2,3}$/.test(primary)) return UNKNOWN;
  const lang = normaliseLang(primary);
  return lang === "en" ? { verdict: "english", lang, basis: "declared" } : { verdict: "not_english", lang, basis: "declared" };
}

// ── Text ────────────────────────────────────────────────────────────

/**
 * Stop words: short, frequent, and — as far as possible — not a word of the
 * other languages listed. English's list leaves out `in`, `an`, `die`, `is`
 * lookalikes that German or Dutch share.
 */
const STOP_WORDS: Record<string, readonly string[]> = {
  en: ["the", "and", "of", "to", "is", "with", "for", "this", "that", "are", "you", "your", "be", "can", "from", "by", "or", "not", "which", "will", "has", "have", "it", "its", "when", "if", "should", "must", "into", "these", "was", "were", "been", "do", "does", "any", "all", "use", "used", "using", "before", "after"],
  de: ["der", "die", "das", "und", "ist", "nicht", "mit", "von", "den", "dem", "des", "ein", "eine", "einer", "einen", "zu", "auf", "für", "sich", "werden", "wird", "sie", "auch", "oder", "bei", "nach", "aus", "wie", "sind", "können", "kann", "wenn", "durch", "über", "nur", "dieser", "diese", "zum", "zur", "im"],
  fr: ["le", "la", "les", "des", "du", "et", "est", "une", "pour", "dans", "avec", "sur", "pas", "qui", "que", "sont", "par", "ce", "cette", "vous", "au", "aux", "de", "ou", "il", "peut", "votre", "vos", "être", "ne", "lors", "leur"],
  es: ["el", "los", "las", "del", "y", "es", "una", "para", "con", "por", "que", "se", "su", "al", "como", "más", "este", "esta", "de", "la", "en", "puede", "sus", "o", "está", "son", "usted"],
  it: ["il", "lo", "gli", "della", "delle", "del", "di", "e", "è", "per", "con", "una", "che", "non", "sono", "alla", "nel", "nella", "dei", "da", "le", "la", "può", "questo", "questa", "essere"],
  pt: ["o", "os", "do", "da", "dos", "das", "em", "não", "para", "com", "uma", "que", "é", "ao", "de", "se", "pode", "são", "na", "seu", "sua", "como", "mais"],
  nl: ["het", "een", "van", "en", "niet", "met", "voor", "op", "zijn", "dat", "die", "wordt", "deze", "ook", "bij", "de", "worden", "kan", "u", "uw", "naar", "om", "te", "door"],
  pl: ["się", "nie", "jest", "że", "dla", "oraz", "jak", "od", "na", "do", "przez", "może", "należy", "przed", "po", "lub", "tym", "jego"],
  sv: ["och", "att", "det", "som", "för", "med", "är", "av", "på", "inte", "den", "till", "ett", "kan", "om", "eller", "har"],
  da: ["og", "er", "til", "den", "ikke", "med", "af", "på", "det", "som", "en", "kan", "eller", "skal", "må", "har"],
  cs: ["je", "se", "na", "pro", "že", "jako", "nebo", "jsou", "také", "při", "před", "být", "lze", "tento"],
  tr: ["ve", "bir", "bu", "için", "ile", "olarak", "veya", "değil", "gibi", "daha", "olan"],
};

const STOP_INDEX: Map<string, string[]> = (() => {
  const index = new Map<string, string[]>();
  for (const [lang, words] of Object.entries(STOP_WORDS)) {
    for (const word of words) index.set(word, [...(index.get(word) ?? []), lang]);
  }
  return index;
})();

/** Non-Latin scripts, each with the language a window mostly in it is called. */
const SCRIPTS: readonly (readonly [RegExp, string])[] = [
  [/[぀-ヿ]/gu, "ja"], // kana before Han: Japanese mixes both
  [/[가-힯ᄀ-ᇿ]/gu, "ko"],
  [/[一-鿿㐀-䶿]/gu, "zh"],
  [/[Ѐ-ӿ]/gu, "ru"],
  [/[؀-ۿ]/gu, "ar"],
  [/[֐-׿]/gu, "he"],
  [/[฀-๿]/gu, "th"],
  [/[Ͱ-Ͽ]/gu, "el"],
];

/** The window size, in characters. */
export const LANGUAGE_WINDOW_CHARS = 1000;
/** A window needs this many stop-word hits on its side to be decided. */
const MIN_HITS = 3;
/** …and this many times the other side's. */
const DOMINANCE = 1.5;
/** At most this much text is read: a thousand-page manual is sampled, not read whole. */
const MAX_TEXT_CHARS = 2_000_000;
/** At most this many windows are judged, spread evenly across the text. */
const MAX_WINDOWS = 400;

export interface TextLanguageOptions {
  /**
   * A manual: one English window is enough, because a multilingual manual has
   * one section per language and any of them may be the English one.
   */
  manual?: boolean;
}

/** One window's language, or null when it cannot be told. */
function windowLanguage(window: string): string | null {
  const letters = (window.match(/\p{L}/gu) ?? []).length;
  if (letters < 40) return null;
  for (const [pattern, lang] of SCRIPTS) {
    const count = (window.match(pattern) ?? []).length;
    // Kana needs only a share: Japanese text is mostly Han with kana between.
    if (lang === "ja" ? count / letters > 0.1 : count / letters > 0.5) return lang;
  }
  const hits = new Map<string, number>();
  for (const word of window.toLowerCase().match(/\p{L}+/gu) ?? []) {
    for (const lang of STOP_INDEX.get(word) ?? []) hits.set(lang, (hits.get(lang) ?? 0) + 1);
  }
  const english = hits.get("en") ?? 0;
  let foreign = 0;
  let foreignLang: string | null = null;
  for (const [lang, count] of hits) {
    if (lang !== "en" && count > foreign) {
      foreign = count;
      foreignLang = lang;
    }
  }
  if (english >= MIN_HITS && english >= foreign * DOMINANCE) return "en";
  if (foreign >= MIN_HITS && foreign >= english * DOMINANCE) return foreignLang;
  return null;
}

/** The text's windows, at most {@link MAX_WINDOWS}, spread over the whole of it. */
function windowsOf(text: string): string[] {
  const body = text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
  const count = Math.ceil(body.length / LANGUAGE_WINDOW_CHARS);
  const step = Math.max(1, Math.ceil(count / MAX_WINDOWS));
  const out: string[] = [];
  for (let i = 0; i < count; i += step) out.push(body.slice(i * LANGUAGE_WINDOW_CHARS, (i + 1) * LANGUAGE_WINDOW_CHARS));
  return out;
}

/**
 * The language of a text. English when at least a fifth of the decided
 * windows are English (a manual: any one) — so an English page
 * with a German paragraph, and a multilingual manual with an English section,
 * are English. Not English when the decided windows are otherwise another
 * language's. Unknown when too little could be decided.
 */
export function textLanguage(text: string | null | undefined, options: TextLanguageOptions = {}): LanguageJudgement {
  const body = (text ?? "").trim();
  if (!body) return UNKNOWN;
  const counts = new Map<string, number>();
  let decided = 0;
  for (const window of windowsOf(body)) {
    const lang = windowLanguage(window);
    if (!lang) continue;
    decided += 1;
    counts.set(lang, (counts.get(lang) ?? 0) + 1);
  }
  if (decided === 0) return UNKNOWN;
  const english = counts.get("en") ?? 0;
  const englishEnough = options.manual ? english >= 1 : english / decided >= 0.2;
  if (englishEnough) return { verdict: "english", lang: "en", basis: "text" };
  let top: string | null = null;
  let topCount = 0;
  for (const [lang, count] of counts) {
    if (lang !== "en" && count > topCount) {
      top = lang;
      topCount = count;
    }
  }
  return top ? { verdict: "not_english", lang: top, basis: "text" } : UNKNOWN;
}

// ── Titles ──────────────────────────────────────────────────────────

/** Words that name a manual in another language — never an English title. */
const FOREIGN_MANUAL_WORDS: readonly (readonly [RegExp, string])[] = [
  [/\b(?:bedienungsanleitung|betriebsanleitung|gebrauchsanweisung|benutzerhandbuch|montageanleitung|kurzanleitung|handbuch|anleitung|sicherheitshinweise)\b/i, "de"],
  [/\b(?:mode d['’]emploi|manuel d['’]utilisation|notice d['’]utilisation|guide de l['’]utilisateur|fiche technique)\b/i, "fr"],
  [/\b(?:manual de(?:l)? usuario|manual de instrucciones|instrucciones de uso|ficha técnica|guía de usuario)\b/i, "es"],
  [/\b(?:manuale d['’]uso|manuale utente|istruzioni per l['’]uso|scheda tecnica)\b/i, "it"],
  [/\b(?:handleiding|gebruiksaanwijzing|gebruikershandleiding)\b/i, "nl"],
  [/\b(?:instrukcja obsługi|instrukcja)\b/i, "pl"],
  [/\b(?:bruksanvisning|användarhandbok)\b/i, "sv"],
  [/\b(?:brugsanvisning|betjeningsvejledning)\b/i, "da"],
  [/\b(?:manual do usuário|manual do utilizador)\b/i, "pt"],
  [/\b(?:návod k obsluze|návod)\b/i, "cs"],
];

/** A link title's language, from its script or a foreign word for "manual"; unknown otherwise. */
export function titleLanguage(title: string | null | undefined): LanguageJudgement {
  const value = (title ?? "").trim();
  if (!value) return UNKNOWN;
  const letters = (value.match(/\p{L}/gu) ?? []).length;
  if (letters >= 2) {
    for (const [pattern, lang] of SCRIPTS) {
      const count = (value.match(pattern) ?? []).length;
      // A title keeps its brand and model in Latin letters ("Bambu Lab X2D 開箱與設定"),
      // so three letters of another script are enough; an English title has none.
      if (count >= 3 || count / letters > 0.5) {
        return { verdict: "not_english", lang, basis: "title" };
      }
    }
  }
  for (const [pattern, lang] of FOREIGN_MANUAL_WORDS) {
    if (pattern.test(value)) return { verdict: "not_english", lang, basis: "title" };
  }
  return UNKNOWN;
}

// ── Together ────────────────────────────────────────────────────────

export interface PageLanguageInput {
  url?: string | null;
  /** The page's declared language (`<html lang>`), when it had one. */
  lang?: string | null;
  text?: string | null;
  /** A manual: one English section is enough. */
  manual?: boolean;
}

/**
 * A page's verdict: decisive text first (a template's `lang="en"` on German
 * text does not pass it; English text under `/de/` is kept), then the declared
 * language, then the URL.
 */
export function pageLanguage(input: PageLanguageInput): LanguageJudgement {
  const byText = textLanguage(input.text, { manual: input.manual });
  if (byText.verdict !== "unknown") return byText;
  const declared = declaredLanguage(input.lang);
  if (declared.verdict !== "unknown") return declared;
  return input.url ? urlLanguage(input.url) : UNKNOWN;
}

const LANGUAGE_NAMES: Record<string, string> = {
  de: "German", fr: "French", es: "Spanish", it: "Italian", pt: "Portuguese", nl: "Dutch", pl: "Polish",
  sv: "Swedish", da: "Danish", no: "Norwegian", fi: "Finnish", cs: "Czech", sk: "Slovak", hu: "Hungarian",
  ro: "Romanian", tr: "Turkish", ru: "Russian", uk: "Ukrainian", ja: "Japanese", zh: "Chinese", ko: "Korean",
  ar: "Arabic", he: "Hebrew", th: "Thai", el: "Greek", vi: "Vietnamese", en: "English",
};

/** "German", or the code when it has no name here. */
export function languageName(lang: string | null | undefined): string {
  return (lang && LANGUAGE_NAMES[lang]) || lang || "unknown";
}

/** Why a judgement is "not English", in a few words: `de, from the page's text`. */
export function describeJudgement(judgement: LanguageJudgement): string {
  const where =
    judgement.basis === "text"
      ? "from the page's text"
      : judgement.basis === "declared"
        ? "the page declares it"
        : judgement.basis === "url"
          ? "from its address"
          : judgement.basis === "title"
            ? "from its title"
            : "no signal";
  return `${judgement.lang ?? "unknown"}, ${where}`;
}

function decodeSafe(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}
