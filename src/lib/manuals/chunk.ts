import type { ManualOutlineEntry } from "../db/schema/manuals.ts";

/**
 * Splitting a manual's stored pages into search passages (manual text spec
 * §3.3, phase 2). Pure: pages and outline in, passages out — no I/O, no model.
 *
 * - **Never across a section.** The outline (the PDF's bookmarks, or headings
 *   inferred from font size) cuts the document into sections. Each outline
 *   entry names the page its section opens on; the cut is placed at the
 *   heading's own line on that page when it can be found there, else at the
 *   top of the page. Text before the first entry is a section with an empty
 *   path (front matter). A manual with no outline is one section.
 * - **About {@link CHUNK_TARGET_CHARS} characters** (~600 tokens) a passage,
 *   packed from paragraphs; a paragraph longer than that is split at sentence
 *   boundaries, and a sentence longer than that at word boundaries.
 * - **About {@link CHUNK_OVERLAP_CHARS} characters of overlap** (~80 tokens):
 *   a passage after the first in its section opens with the trailing sentences
 *   of the one before, so an answer straddling the cut is still whole in one.
 * - **Pages are recorded**, not guessed: every line keeps the 1-based PDF page
 *   it came from, and a passage spans the pages of its first and last line.
 * - **The contextual header** — `"<tool name> — <document title> › <section
 *   path>"` — is prefixed to `searchText`, the text both indexes see, so "change
 *   the tank on the Form 4" can match a passage whose own words never say
 *   "Form 4". `content` is the passage alone, for display and citation.
 *
 * Bump {@link CHUNKER_VERSION} whenever what this produces changes: stored
 * documents built by another version are re-chunked (and re-embedded) by the
 * index step and the backfill.
 */

/** Recorded on `manual_documents.chunker_version`. */
export const CHUNKER_VERSION = "chunk-2";

/** Target passage size: ~600 tokens at ~4 characters a token. */
export const CHUNK_TARGET_CHARS = 2400;

/** Overlap carried into the next passage of the same section: ~80 tokens. */
export const CHUNK_OVERLAP_CHARS = 320;

/** A passage with less text than this is a stray heading, not something to retrieve. */
const MIN_CHUNK_CHARS = 25;

/** Section titles are capped in the path, so a runaway bookmark cannot bloat every header. */
const MAX_TITLE_CHARS = 120;

export interface ChunkPage {
  pageNumber: number;
  text: string;
}

export interface ChunkInput {
  /** The catalogue name of the tool the manual belongs to, when it has one. */
  toolName: string | null;
  /** The document's title (the resource's title, usually). */
  documentTitle: string;
  pages: readonly ChunkPage[];
  outline: readonly ManualOutlineEntry[];
}

export interface ManualChunk {
  /** 0-based position in the document. */
  ordinal: number;
  sectionPath: string[];
  pageStart: number;
  pageEnd: number;
  content: string;
  searchText: string;
}

interface Line {
  text: string;
  page: number;
}

interface Section {
  path: string[];
  lines: Line[];
}

/** A run of text that stays whole unless it is too long on its own. */
interface Unit {
  text: string;
  pageStart: number;
  pageEnd: number;
}

/** `"Form 4 — Form 4 Manual › Maintenance › Resin tank"`. */
export function contextualHeader(toolName: string | null, documentTitle: string, sectionPath: readonly string[]): string {
  const title = documentTitle.trim() || "Manual";
  const head = toolName && toolName.trim() && !sameText(toolName, title) ? `${toolName.trim()} — ${title}` : title;
  return sectionPath.length > 0 ? `${head} › ${sectionPath.join(" › ")}` : head;
}

/** Split a manual into passages, in document order. */
export function chunkManual(input: ChunkInput): ManualChunk[] {
  const sections = splitSections(input.pages, input.outline);
  const chunks: ManualChunk[] = [];
  for (const section of sections) {
    const header = contextualHeader(input.toolName, input.documentTitle, section.path);
    for (const piece of packSection(section.lines)) {
      if (piece.text.replace(/\s+/g, "").length < MIN_CHUNK_CHARS) continue;
      chunks.push({
        ordinal: chunks.length,
        sectionPath: section.path,
        pageStart: piece.pageStart,
        pageEnd: piece.pageEnd,
        content: piece.text,
        searchText: `${header}\n\n${piece.text}`,
      });
    }
  }
  return chunks;
}

// ── Sections ────────────────────────────────────────────────────────

/** Cut the document's lines at each outline entry, carrying the chapter trail. */
export function splitSections(pages: readonly ChunkPage[], outline: readonly ManualOutlineEntry[]): Section[] {
  const lines: Line[] = [];
  const pageStartIndex = new Map<number, number>();
  const sorted = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);
  for (const page of sorted) {
    pageStartIndex.set(page.pageNumber, lines.length);
    for (const text of page.text.split("\n")) lines.push({ text: text.trimEnd(), page: page.pageNumber });
  }
  const lastPage = sorted.length ? sorted[sorted.length - 1].pageNumber : 0;

  // Entries in page order (stable, so the outline's own order holds within a page).
  const entries = outline
    .map((entry, index) => ({ ...entry, index }))
    .filter((entry) => entry.page >= 1 && entry.page <= lastPage && entry.title.trim())
    .sort((a, b) => a.page - b.page || a.index - b.index);

  const cuts: { at: number; path: string[] }[] = [];
  const stack: { level: number; title: string }[] = [];
  let lastAt = 0;
  for (const entry of entries) {
    const start = pageStartIndex.get(entry.page) ?? nextPageStart(pageStartIndex, entry.page, lines.length);
    const end = nextPageStart(pageStartIndex, entry.page + 1, lines.length);
    const found = findHeadingLine(lines, Math.max(start, lastAt), end, entry.title);
    const at = Math.max(found ?? start, lastAt);
    while (stack.length > 0 && stack[stack.length - 1].level >= entry.level) stack.pop();
    stack.push({ level: entry.level, title: cleanTitle(entry.title) });
    cuts.push({ at, path: stack.map((s) => s.title) });
    lastAt = at;
  }

  const sections: Section[] = [];
  const firstAt = cuts.length ? cuts[0].at : lines.length;
  if (firstAt > 0) sections.push(...numberedSubsections({ path: [], lines: lines.slice(0, firstAt) }));
  for (let i = 0; i < cuts.length; i += 1) {
    const from = cuts[i].at;
    const to = i + 1 < cuts.length ? cuts[i + 1].at : lines.length;
    if (to > from) sections.push(...numberedSubsections({ path: cuts[i].path, lines: lines.slice(from, to) }));
  }
  return sections.filter((section) => section.lines.some((line) => line.text.trim()));
}

/**
 * A numbered heading printed in the text — "2.2 Technical specifications",
 * "5.3.1 Replacing the tank" — that the outline does not carry. Many PDFs
 * bookmark only their chapters (and an inferred outline often finds only
 * those), so without this a whole chapter is one section and every passage in
 * it has the same header. Deliberately strict: two or more number parts, a
 * capitalised title of at least two words, no trailing page number (a
 * contents line) and no sentence ending.
 */
const NUMBERED_HEADING = /^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\p{Lu}[\p{L}'’()/&,\- ]{2,80})$/u;

function numberedHeading(text: string): { depth: number; title: string } | null {
  const trimmed = text.trim();
  if (trimmed.length > 90) return null;
  const match = trimmed.match(NUMBERED_HEADING);
  if (!match) return null;
  const words = match[2].trim().split(/\s+/);
  if (words.length < 2 || words[0].replace(/[^\p{L}]/gu, "").length < 3) return null;
  return { depth: match[1].split(".").length, title: `${match[1]} ${match[2].trim()}` };
}

/** Split one outline section further at numbered headings, extending its path. */
function numberedSubsections(section: Section): Section[] {
  const out: Section[] = [];
  const outlineTitles = new Set(section.path.map(normalise));
  const stack: { depth: number; title: string }[] = [];
  let current: Section = { path: section.path, lines: [] };
  for (const line of section.lines) {
    const heading = numberedHeading(line.text);
    const known = heading && (outlineTitles.has(normalise(heading.title)) || outlineTitles.has(normalise(heading.title.replace(/^[\d.]+\s+/, ""))));
    if (heading && !known) {
      if (current.lines.length > 0) out.push(current);
      while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) stack.pop();
      stack.push(heading);
      current = { path: [...section.path, ...stack.map((s) => cleanTitle(s.title))], lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.lines.length > 0) out.push(current);
  return out;
}

function nextPageStart(index: Map<number, number>, page: number, fallback: number): number {
  let best = fallback;
  for (const [p, at] of index) if (p >= page && at < best) best = at;
  return best;
}

/** The index of the line in [from, to) that is the heading `title`, or null. */
function findHeadingLine(lines: readonly Line[], from: number, to: number, title: string): number | null {
  const wanted = normalise(title);
  if (!wanted) return null;
  for (let i = from; i < to; i += 1) {
    const line = normalise(lines[i].text);
    if (!line) continue;
    if (line === wanted) return i;
    // "3.2 Replacing the tank" for the bookmark "Replacing the tank".
    if (line.endsWith(wanted) && line.length - wanted.length <= 8 && /^[0-9ivx .-]*$/.test(line.slice(0, line.length - wanted.length))) {
      return i;
    }
    // A heading wrapped over two lines: its first line opens the title.
    if (wanted.startsWith(line) && line.length >= Math.min(12, wanted.length)) return i;
  }
  return null;
}

function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanTitle(title: string): string {
  const flat = title.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TITLE_CHARS ? `${flat.slice(0, MAX_TITLE_CHARS - 1)}…` : flat;
}

function sameText(a: string, b: string): boolean {
  return normalise(a) === normalise(b);
}

// ── Packing ─────────────────────────────────────────────────────────

/**
 * Paragraph-ish units from a section's lines. Extracted text has no blank
 * lines between paragraphs, so a unit ends after a blank line, a line that
 * ends a sentence, or a page break; the packer only ever cuts between units.
 */
function toUnits(lines: readonly Line[]): Unit[] {
  const units: Unit[] = [];
  let current: Line[] = [];
  const flush = () => {
    const text = current.map((line) => line.text).join("\n").trim();
    if (text) units.push({ text, pageStart: current[0].page, pageEnd: current[current.length - 1].page });
    current = [];
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.text.trim()) {
      flush();
      continue;
    }
    current.push(line);
    const next = lines[i + 1];
    if (!next || next.page !== line.page || /[.!?:;]["')\]]?$/.test(line.text.trim())) flush();
  }
  flush();
  return units;
}

/** Pack a section into passages of about {@link CHUNK_TARGET_CHARS}, with overlap. */
function packSection(lines: readonly Line[]): Unit[] {
  const units = toUnits(lines).flatMap(splitOversize);
  const out: Unit[] = [];
  let parts: Unit[] = [];
  let size = 0;
  /** Whether `parts` holds anything beyond the overlap carried from the passage before. */
  let fresh = false;

  const emit = () => {
    if (parts.length === 0) return;
    out.push({
      text: parts.map((part) => part.text).join("\n"),
      pageStart: parts[0].pageStart,
      pageEnd: parts[parts.length - 1].pageEnd,
    });
  };

  for (const unit of units) {
    const added = unit.text.length + (parts.length ? 1 : 0);
    if (parts.length > 0 && size + added > CHUNK_TARGET_CHARS) {
      emit();
      const carry = overlapFrom(parts);
      parts = carry ? [carry] : [];
      size = carry ? carry.text.length : 0;
    }
    parts.push(unit);
    fresh = true;
    size += unit.text.length + (parts.length > 1 ? 1 : 0);
  }
  if (fresh) emit();
  return out;
}

/** The trailing ~{@link CHUNK_OVERLAP_CHARS} characters of a passage, cut at sentence (else word) boundaries. */
function overlapFrom(parts: readonly Unit[]): Unit | null {
  const last = parts[parts.length - 1];
  const joined = parts.map((part) => part.text).join("\n");
  const earliest = joined.length - CHUNK_OVERLAP_CHARS;
  if (earliest <= 0) return null; // The whole passage is shorter than the overlap: nothing worth repeating.
  // The earliest sentence start within reach, so the overlap is an exact suffix
  // of the passage (search merges adjacent passages by that seam).
  const boundary = /(?<=[.!?]["')\]]?)\s+|\n/g;
  let cut = -1;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(joined))) {
    const start = match.index + match[0].length;
    if (start >= earliest && start < joined.length) {
      cut = start;
      break;
    }
  }
  if (cut < 0) {
    // One long final sentence: its last few words.
    const space = joined.indexOf(" ", earliest);
    cut = space < 0 ? -1 : space + 1;
  }
  const text = cut < 0 ? "" : joined.slice(cut);
  return text.trim() ? { text, pageStart: last.pageEnd, pageEnd: last.pageEnd } : null;
}

/** A unit longer than a passage, split at sentences, then words. */
function splitOversize(unit: Unit): Unit[] {
  if (unit.text.length <= CHUNK_TARGET_CHARS) return [unit];
  const pieces: string[] = [];
  let current = "";
  for (const sentence of splitSentences(unit.text)) {
    for (const part of sentence.length > CHUNK_TARGET_CHARS ? splitWords(sentence) : [sentence]) {
      if (current && current.length + 1 + part.length > CHUNK_TARGET_CHARS) {
        pieces.push(current);
        current = part;
      } else {
        current = current ? `${current} ${part}` : part;
      }
    }
  }
  if (current) pieces.push(current);
  // A unit never spans more than a page (toUnits breaks at page changes).
  return pieces.map((text) => ({ text, pageStart: unit.pageStart, pageEnd: unit.pageEnd }));
}

function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?])\s+(?=[\p{Lu}\p{N}"'(•\-–])|\n+/u)
    .map((s) => s.trim())
    .filter(Boolean);
}

function splitWords(text: string): string[] {
  const words = text.split(/\s+/);
  const out: string[] = [];
  let current = "";
  for (const word of words) {
    if (current && current.length + 1 + word.length > CHUNK_TARGET_CHARS) {
      out.push(current);
      current = word;
    } else current = current ? `${current} ${word}` : word;
  }
  if (current) out.push(current);
  return out.flatMap((piece) =>
    piece.length > CHUNK_TARGET_CHARS ? piece.match(new RegExp(`.{1,${CHUNK_TARGET_CHARS}}`, "gs")) ?? [] : [piece]
  );
}
