/**
 * Manual citations in an answer (UI system spec §9.1, phase 5b).
 *
 * `search_manual` builds every passage's `citation` ("Form 4 Manual, p. 42")
 * and a `url` that opens the stored PDF at that page, and its prompt has the
 * model cite a fact as a Markdown link to that url (capabilities/manuals.ts).
 * The call's output streams to the browser as the tool part's `output`, so the
 * chat can recognise those links for what they are: a link whose address is
 * one of this message's passage URLs is a citation — drawn inline with its
 * page — and the passages the answer linked are its `Sources`.
 *
 * Nothing is inferred from the link text: only an address the tool returned
 * counts, so a model cannot make an ordinary link look like evidence.
 */

export interface ManualPassageRef {
  /** "Form 4 Manual, p. 42" — built by the tool, not the model. */
  citation: string;
  /** Opens the PDF at the page. */
  url: string;
  /** "Maintenance › Resin tank", or empty. */
  section: string;
  /** The passage's words, unfenced and shortened, or empty. */
  excerpt: string;
}

interface SearchManualOutput {
  status?: unknown;
  passages?: unknown;
}

const EXCERPT_MAX = 280;

/** Every passage with a URL that this message's finished `search_manual` calls returned, by URL. */
export function manualPassages(parts: readonly { type: string }[]): Map<string, ManualPassageRef> {
  const byUrl = new Map<string, ManualPassageRef>();
  for (const part of parts) {
    if (part.type !== "tool-search_manual") continue;
    const { state, output } = part as { state?: string; output?: SearchManualOutput };
    if (state !== "output-available" || !output || output.status !== "ok" || !Array.isArray(output.passages)) continue;
    for (const raw of output.passages as Array<Record<string, unknown>>) {
      const url = typeof raw?.url === "string" ? raw.url.trim() : "";
      const citation = typeof raw?.citation === "string" ? raw.citation.trim() : "";
      if (!url || !citation || byUrl.has(url)) continue;
      byUrl.set(url, {
        citation,
        url,
        section: typeof raw.section === "string" ? raw.section : "",
        excerpt: typeof raw.text === "string" ? passageExcerpt(raw.text) : "",
      });
    }
  }
  return byUrl;
}

/** The passages a text links to, in the order it first links them. */
export function citedPassages(text: string, passages: ReadonlyMap<string, ManualPassageRef>): ManualPassageRef[] {
  if (passages.size === 0) return [];
  const found: Array<{ at: number; passage: ManualPassageRef }> = [];
  for (const passage of passages.values()) {
    const at = text.indexOf(`](${passage.url})`);
    if (at >= 0) found.push({ at, passage });
  }
  return found.sort((a, b) => a.at - b.at).map(({ passage }) => passage);
}

/** "Form 4 Manual, pp. 44–45 (printed 3-12)" → "pp. 44–45": the part a reader scans for. */
export function pageMark(citation: string): string {
  const match = citation.match(/\bpp?\. [^,()]+?(?=\s*(?:\(|$))/);
  return match ? match[0].trim() : citation;
}

/**
 * The linked words without the citation the model was told to repeat in them:
 * "Replacing the resin tank (Form 4 Manual, p. 42)" → "Replacing the resin
 * tank", since the mark after it says the page. Words that are nothing but
 * the citation keep the manual's name ("Form 4 Manual").
 */
export function citationPhrase(words: string, citation: string): string {
  const text = words.trim();
  if (text === citation) return citation.replace(/,\s*pp?\. .*$/, "");
  const suffix = `(${citation})`;
  if (text.endsWith(suffix)) {
    const rest = text.slice(0, -suffix.length).trim();
    if (rest) return rest;
  }
  return words;
}

/**
 * The words of a fenced passage (`web/fence.ts`): the opening marker and its
 * one-line preamble and the closing marker removed, whitespace folded, cut to
 * a readable length. Shown as plain text, never as Markdown or HTML.
 */
export function passageExcerpt(fenced: string): string {
  const lines = fenced.split("\n");
  const body =
    lines.length >= 3 && /^<untrusted-page\b/.test(lines[0]) && /^<\/untrusted-page\b/.test(lines[lines.length - 1])
      ? lines.slice(2, -1).join(" ")
      : fenced.replace(/<\/?untrusted-page\b[^>]*>/g, " ");
  const text = body.replace(/\s+/g, " ").trim();
  return text.length > EXCERPT_MAX ? `${text.slice(0, EXCERPT_MAX - 1).trimEnd()}…` : text;
}
