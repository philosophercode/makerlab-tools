import { createHash } from "node:crypto";
import type { SkillInputs } from "./inputs.ts";

/**
 * The digest of everything a tool skill was written from (tool skills spec
 * 2026-10-07 §5.3): the catalogue record, the lab notes, the research summary,
 * the linked documents, the manual passages (by document, pages and text), the
 * prompt's version and the model. Not the time and not the version number, so
 * the same inputs always hash the same, on any deployment.
 *
 * An automatic write whose hash matches the tool's current skill asks the
 * model nothing; the admin page says "Out of date" when it differs.
 */
export function skillInputHash(inputs: SkillInputs, context: { model: string; promptVersion: string }): string {
  // Whether the tool is published says nothing the skill says: publishing a
  // draft must not make its skill out of date.
  const { published: _published, ...tool } = inputs.tool;
  void _published;
  const payload = {
    promptVersion: context.promptVersion,
    model: context.model,
    tool,
    toolNotes: inputs.toolNotes.map((note) => note.text),
    labNotes: inputs.labNotes.map((note) => note.text),
    research: inputs.research ? { text: inputs.research.text, urls: inputs.research.urls } : null,
    links: inputs.links.map((link) => [link.title, link.type, link.url]),
    passages: inputs.passages.map((passage) => [passage.documentId, passage.pageStart, passage.pageEnd, passage.section, passage.content]),
  };
  return `sha256:${createHash("sha256").update(canonicalJson(payload)).digest("hex")}`;
}

/** JSON with object keys sorted at every level, so key order never changes the digest. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v
  );
}
