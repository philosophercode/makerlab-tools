import type { MakerLabTool } from "../catalog-types";

/** A tool the page links to by name. */
export interface ToolLink {
  slug: string;
  name: string;
}

export interface ToolRelations {
  /** The tool this one is an accessory of, when it is published. */
  accessoryOf: ToolLink | null;
  /** The published tools that are accessories of this one, by name. */
  accessories: ToolLink[];
}

/**
 * A tool's accessory links (taxonomy v2 facet `parent_tool_id`), read from the
 * published catalogue the page already has cached — no query of its own. A
 * parent or accessory that is a draft or archived is simply not linked:
 * the public page never points at a page the visitor cannot open.
 */
export function toolRelations(tool: Pick<MakerLabTool, "id" | "parentToolId">, catalogue: readonly MakerLabTool[]): ToolRelations {
  const parent = tool.parentToolId ? catalogue.find((other) => other.id === tool.parentToolId) : undefined;
  const accessories = catalogue
    .filter((other) => other.parentToolId === tool.id && other.id !== tool.id)
    .map((other) => ({ slug: other.slug, name: other.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { accessoryOf: parent ? { slug: parent.slug, name: parent.name } : null, accessories };
}
