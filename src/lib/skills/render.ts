import {
  SKILL_SECTION_TITLES,
  sourcePages,
  type SkillBullet,
  type SkillSection,
  type SkillSections,
  type SkillSource,
  type SkillTrouble,
} from "./format.ts";

/**
 * A tool skill as markdown, rendered by code from its stored sections and
 * sources (tool skills spec 2026-10-07 §5.2.2 step 7, §5.6). Pure and
 * deterministic: the same row always renders the same.
 *
 * - {@link renderSkillMarkdown} — the whole guide, in the shape of a Claude
 *   Code `SKILL.md`: a frontmatter-like header (`name`, `description` — "Use
 *   when someone asks to operate, debug, or plan a build with …"), then the
 *   sections, then every cited source in full. Stored as
 *   `tool_skills.content`, shown on the admin page, returned by
 *   `get_tool_skill`.
 * - {@link renderSkillCompact} — the same guide for the chat's prompt on a
 *   tool page: no header, one-line sources, within a character budget. Past
 *   it, lower sections are dropped in a fixed order, and Safety, Before you
 *   start, the procedure and When to get staff never are.
 *
 * A model's words reach the markdown one line per item, with markdown links
 * and images flattened to their text, so an item can neither add a link nor
 * break the structure.
 */

export interface SkillRenderMeta {
  toolName: string;
  slug: string;
  version: number;
  /** ISO 8601. */
  generatedAt: string;
  model: string;
}

/** The note under the title, and what every reader of a skill is told. */
export const SKILL_NOTE =
  "AI-written from the lab's sources. Every fact cites one: [T1] the lab's catalogue record, [N…] the tool's lab notes, [L…] lab rules, [M…] manual pages, [R1] research, [K…] linked documents. Check the manual and lab staff for anything safety-related.";

export function renderSkillMarkdown(meta: SkillRenderMeta, sections: SkillSections, sources: readonly SkillSource[]): string {
  const header = [
    "---",
    `name: ${JSON.stringify(meta.slug)}`,
    `description: ${JSON.stringify(skillDescription(meta.toolName))}`,
    `tool: ${JSON.stringify(meta.toolName)}`,
    `version: ${meta.version}`,
    `generated: ${meta.generatedAt.slice(0, 10)}`,
    `model: ${JSON.stringify(meta.model)}`,
    "---",
    "",
    `# ${flat(meta.toolName)}: operating guide`,
    "",
    `> ${SKILL_NOTE}`,
  ].join("\n");
  const body = SECTIONS.flatMap((key) => renderSection(key, sections)).join("\n\n");
  const missing = renderNotInSources(sections);
  const cited = sources.length > 0 ? ["## Sources", sources.map((source) => `- ${sourceLine(source)}`).join("\n")].join("\n\n") : "";
  return [header, body, missing, cited].filter(Boolean).join("\n\n") + "\n";
}

/** The markdown without its `---` header block — what a page renders (the header is shown as facts). */
export function stripFrontmatter(markdown: string): string {
  return markdown.replace(/^---\n[\s\S]*?\n---\n+/, "");
}

/** The `description` line: when an AI should use this skill. */
export function skillDescription(toolName: string): string {
  return `Use when someone asks to operate, debug, or plan a build with the ${flat(toolName)}.`;
}

const SECTIONS: readonly SkillSection[] = [
  "quickFacts",
  "beforeYouStart",
  "operatingProcedure",
  "settingsAndLimits",
  "materials",
  "troubleshooting",
  "safety",
  "whenToGetStaff",
];

function renderSection(key: SkillSection, sections: SkillSections, limit?: number): string[] {
  const title = `## ${SKILL_SECTION_TITLES[key]}`;
  if (key === "troubleshooting") {
    const rows = sections.troubleshooting.slice(0, limit);
    return rows.length > 0 ? [`${title}\n\n${rows.map(troubleLine).join("\n")}`] : [];
  }
  const items = (sections[key] as SkillBullet[]).slice(0, limit);
  if (items.length === 0) return [];
  const lines = key === "operatingProcedure" ? items.map((item, i) => `${i + 1}. ${itemText(item)}`) : items.map((item) => `- ${itemText(item)}`);
  return [`${title}\n\n${lines.join("\n")}`];
}

function renderNotInSources(sections: SkillSections): string {
  if (sections.notInSources.length === 0) return "";
  return `## Not in the lab's sources\n\nAsk staff about these:\n\n${sections.notInSources.map((line) => `- ${flat(line)}`).join("\n")}`;
}

function itemText(item: Pick<SkillBullet, "text" | "cites">): string {
  return `${flat(item.text)}${citeMark(item.cites)}`;
}

function troubleLine(row: SkillTrouble): string {
  return `- **${flat(row.symptom)}** Check: ${flat(row.check)} Fix: ${flat(row.fix)}${citeMark(row.cites)}`;
}

function citeMark(cites: readonly string[]): string {
  return cites.length > 0 ? ` [${cites.join(", ")}]` : "";
}

/** One line, with markdown links and images flattened to their text. */
function flat(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/!?\[([^\]]*)\]\(([^)]*)\)/g, "$1")
    .trim();
}

/** A cited source in full, for the Sources list. */
export function sourceLine(source: SkillSource): string {
  switch (source.kind) {
    case "catalog":
      return `[${source.id}] The lab's catalogue record for the ${flat(source.toolName)}`;
    case "lab_note":
      return `[${source.id}] ${source.scope === "tool" ? "Lab note" : "Lab rule (whole lab)"}: ${flat(source.text)}`;
    case "manual": {
      const section = source.section.length > 0 ? ` (${source.section.map(flat).join(" › ")})` : "";
      return `[${source.id}] ${flat(source.title)}, ${source.pageEnd > source.pageStart ? "pp." : "p."} ${sourcePages(source)}${section}`;
    }
    case "research": {
      const when = source.researchedAt ? ` (${source.researchedAt.slice(0, 10)})` : "";
      return `[${source.id}] Research summary${when}${source.urls.length > 0 ? `: ${source.urls.join(", ")}` : ""}`;
    }
    case "link":
      return `[${source.id}] ${source.type ? `${flat(source.type)}: ` : ""}${flat(source.title)}${source.url ? ` — ${source.url}` : ""}`;
  }
}

/** A cited source in a few words, for the compact form. */
export function sourceShort(source: SkillSource): string {
  switch (source.kind) {
    case "catalog":
      return `${source.id} lab record`;
    case "lab_note":
      return `${source.id} ${source.scope === "tool" ? "lab note" : "lab rule"}`;
    case "manual":
      return `${source.id} ${flat(source.title)} p. ${sourcePages(source)}`;
    case "research":
      return `${source.id} research (${source.urls.length} page${source.urls.length === 1 ? "" : "s"})`;
    case "link":
      return `${source.id} ${flat(source.title)}`;
  }
}

/**
 * Lower sections, in the order the compact form drops them when it is over
 * budget: Materials, the Sources line, Quick facts, Troubleshooting past its
 * first three rows, then Settings and limits past its first six. Safety,
 * Before you start, the procedure and When to get staff are never dropped.
 */
const TRIM_STEPS = ["materials", "sources", "quickFacts", "troubleshooting", "settingsAndLimits", "notInSources"] as const;
type TrimStep = (typeof TRIM_STEPS)[number];

export const COMPACT_TRIMMED_NOTE = "(Shortened to fit. The whole guide, with every source: call get_tool_skill.)";

export function renderSkillCompact(
  meta: Pick<SkillRenderMeta, "toolName" | "version" | "generatedAt">,
  sections: SkillSections,
  sources: readonly SkillSource[],
  maxChars: number
): string {
  const dropped = new Set<TrimStep>();
  const build = () => {
    const parts: string[] = [`# ${flat(meta.toolName)}: operating guide (version ${meta.version}, ${meta.generatedAt.slice(0, 10)})`];
    for (const key of SECTIONS) {
      if (key === "materials" && dropped.has("materials")) continue;
      if (key === "quickFacts" && dropped.has("quickFacts")) continue;
      const limit = key === "troubleshooting" && dropped.has("troubleshooting") ? 3 : key === "settingsAndLimits" && dropped.has("settingsAndLimits") ? 6 : undefined;
      parts.push(...renderSection(key, sections, limit));
    }
    if (!dropped.has("notInSources")) {
      const missing = renderNotInSources(sections);
      if (missing) parts.push(missing);
    }
    if (!dropped.has("sources") && sources.length > 0) parts.push(`Sources: ${sources.map(sourceShort).join(" · ")}`);
    if (dropped.size > 0) parts.push(COMPACT_TRIMMED_NOTE);
    return parts.join("\n\n");
  };
  let text = build();
  for (const step of TRIM_STEPS) {
    if (text.length <= maxChars) return text;
    dropped.add(step);
    text = build();
  }
  if (text.length <= maxChars) return text;
  // Still over: cut at a line, and say so.
  const room = Math.max(0, maxChars - COMPACT_TRIMMED_NOTE.length - 2);
  const cut = text.slice(0, room);
  const atLine = cut.lastIndexOf("\n");
  return `${atLine > 0 ? cut.slice(0, atLine) : cut}\n\n${COMPACT_TRIMMED_NOTE}`;
}
