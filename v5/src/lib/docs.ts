import docsText from "./docs-text.json";

export interface DocsText {
  generated_at: string;
  tools: Record<
    string,
    {
      tool_name: string;
      tool_slug: string;
      resources: Array<{
        resource_id: string;
        resource_title: string;
        text: string;
      }>;
    }
  >;
}

const data = docsText as DocsText;

export function getToolDocs(
  toolId: string
): { resource_title: string; text: string }[] {
  const tool = data.tools?.[toolId];
  if (!tool || !Array.isArray(tool.resources)) return [];
  return tool.resources.map((r) => ({
    resource_title: r.resource_title,
    text: r.text,
  }));
}

export function listToolsWithDocs(): Array<{
  tool_id: string;
  tool_name: string;
  resource_titles: string[];
}> {
  if (!data.tools) return [];
  return Object.entries(data.tools).map(([tool_id, t]) => ({
    tool_id,
    tool_name: t.tool_name,
    resource_titles: t.resources.map((r) => r.resource_title),
  }));
}
