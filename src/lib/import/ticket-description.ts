/**
 * Undo `formatTicketDescription` (spec §5.7 step 5).
 *
 * v5 writes a maintenance ticket's description to Notion as sections:
 *
 *     **What happened**
 *     <text>
 *
 *     **Reported by**
 *     <name>
 *
 *     **Date reported**
 *     <YYYY-MM-DD>
 *
 *     **Priority**
 *     <Low | Medium | High | Critical>
 *
 * The import parses these back into columns. When the text is not exactly that
 * shape — hand-edited in Notion, or written before the template existed — the
 * original text is kept whole as the description so nothing is lost, and any
 * sections that were recognised still fill their columns.
 */

export interface ParsedTicketDescription {
  description: string | null;
  reportedBy: string | null;
  dateReported: string | null;
  priority: string | null;
  /** True when at least one template heading was found. */
  templated: boolean;
  /** True when the whole text was sections and nothing else. */
  exact: boolean;
}

const HEADINGS = {
  "What happened": "whatHappened",
  "Reported by": "reportedBy",
  "Date reported": "dateReported",
  Priority: "priority",
} as const;

type Section = (typeof HEADINGS)[keyof typeof HEADINGS];

const SECTION_PATTERN = /\*\*(What happened|Reported by|Date reported|Priority)\*\*\n/g;

export function parseTicketDescription(text: string | null | undefined): ParsedTicketDescription {
  const raw = (text ?? "").replace(/\r\n/g, "\n");
  const trimmed = raw.trim();
  if (!trimmed) {
    return { description: null, reportedBy: null, dateReported: null, priority: null, templated: false, exact: true };
  }

  const matches = [...trimmed.matchAll(SECTION_PATTERN)];
  if (matches.length === 0) {
    return { description: trimmed, reportedBy: null, dateReported: null, priority: null, templated: false, exact: false };
  }

  const sections: Partial<Record<Section, string>> = {};
  let exact = matches[0].index === 0;
  for (let i = 0; i < matches.length; i += 1) {
    const match = matches[i];
    const key = HEADINGS[match[1] as keyof typeof HEADINGS];
    const start = (match.index ?? 0) + match[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? trimmed.length) : trimmed.length;
    const body = trimmed.slice(start, end).trim();
    if (key in sections) exact = false; // a repeated heading is not the template
    sections[key] = body;
  }

  // The template joins sections with a blank line; anything else between them
  // means a person edited the text, and the whole text is kept as the description.
  const rebuilt = matches
    .map((match, i) => {
      const key = HEADINGS[match[1] as keyof typeof HEADINGS];
      return `**${match[1]}**\n${sections[key] ?? ""}${i + 1 < matches.length ? "\n\n" : ""}`;
    })
    .join("");
  if (rebuilt !== trimmed) exact = false;

  return {
    description: exact ? sections.whatHappened || null : trimmed,
    reportedBy: sections.reportedBy || null,
    dateReported: sections.dateReported || null,
    priority: sections.priority || null,
    templated: true,
    exact,
  };
}
