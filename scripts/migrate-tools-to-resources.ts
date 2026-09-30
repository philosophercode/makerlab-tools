// Audit + one-shot migration: copy legacy Tools URL/file properties
// (sop_url, safety_doc_url, video_url, manual_attachments) into the
// Resources table as new rows. Reads legacy properties directly from
// raw Notion pages so this stays runnable after the legacy fields are
// dropped from the codebase's TypeScript types.

import { fetchAllResources } from "../src/lib/notion.ts";
import type { ResourceRecord } from "../src/lib/types.ts";

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

type LegacyKind = "SOP" | "Safety" | "Video" | "Manual";

interface PlannedResource {
  toolId: string;
  toolName: string;
  kind: LegacyKind;
  title: string;
  url: string;
}

interface ResourcesSchema {
  databaseId: string;
  titleProp: string;
  toolRelationProp: string;
  typeSelectProp: string;
  urlProp: string | null;
  urlPropType: "url" | "rich_text" | null;
  filesProp: string | null;
}

interface NotionRichTextPart {
  plain_text?: string;
}

interface NotionFile {
  name?: string;
  type?: "file" | "external";
  file?: { url?: string };
  external?: { url?: string };
}

interface NotionProperty {
  type: string;
  title?: NotionRichTextPart[];
  rich_text?: NotionRichTextPart[];
  url?: string | null;
  files?: NotionFile[];
}

interface NotionPage {
  id: string;
  properties: Record<string, NotionProperty>;
}

interface NotionQueryResponse {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string | null;
}

interface DatabaseResponse {
  id: string;
  properties: Record<
    string,
    {
      id: string;
      name: string;
      type: string;
      relation?: { database_id: string };
    }
  >;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env: ${name}`);
  return value;
}

async function notionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = requireEnv("NOTION_API_KEY");
  const res = await fetch(`${NOTION_API_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "Notion-Version": NOTION_VERSION,
      ...init?.headers,
    },
  });

  if (res.status === 429) {
    const retryAfter = Number(res.headers.get("Retry-After") || "1");
    await new Promise((resolve) => setTimeout(resolve, retryAfter * 1000));
    return notionFetch<T>(path, init);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status} ${path}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function queryAllToolPages(): Promise<NotionPage[]> {
  const databaseId = requireEnv("NOTION_DB_TOOLS");
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const data = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        ...(startCursor ? { start_cursor: startCursor } : {}),
      }),
    });
    pages.push(...data.results);
    startCursor = data.next_cursor || undefined;
  } while (startCursor);

  return pages;
}

function findProperty(
  page: NotionPage,
  names: string[]
): NotionProperty | undefined {
  return names.map((name) => page.properties[name]).find(Boolean);
}

function richTextOf(property?: NotionProperty): string {
  if (!property) return "";
  if (property.type === "rich_text") {
    return property.rich_text?.map((part) => part.plain_text || "").join("") || "";
  }
  if (property.type === "url") return property.url || "";
  return "";
}

function titleOf(page: NotionPage): string {
  const titleProperty = Object.values(page.properties).find((p) => p.type === "title");
  return titleProperty?.title?.map((part) => part.plain_text || "").join("") || "";
}

function filesOf(property?: NotionProperty): Array<{ filename: string; url: string }> {
  if (property?.type !== "files") return [];
  return (property.files || []).flatMap((file, index) => {
    const url = file.type === "external" ? file.external?.url : file.file?.url;
    if (!url) return [];
    return [{ filename: file.name || `manual-${index + 1}`, url }];
  });
}

async function discoverResourcesSchema(): Promise<ResourcesSchema> {
  const databaseId = requireEnv("NOTION_DB_RESOURCES");
  const toolsDbId = requireEnv("NOTION_DB_TOOLS");

  const db = await notionFetch<DatabaseResponse>(`/databases/${databaseId}`);

  const props = Object.values(db.properties);
  const titleProp = props.find((p) => p.type === "title");
  if (!titleProp) throw new Error("Resources DB is missing a title property");

  const toolRelationProp = props.find(
    (p) =>
      p.type === "relation" &&
      p.relation?.database_id.replace(/-/g, "") === toolsDbId.replace(/-/g, "")
  );
  if (!toolRelationProp) {
    throw new Error("Resources DB has no relation pointing to Tools");
  }

  const typeSelectProp = props.find((p) => p.type === "select");
  if (!typeSelectProp) throw new Error("Resources DB is missing a select property for type");

  const urlProp = props.find((p) => p.type === "url");
  const richTextUrlProp = urlProp
    ? null
    : props.find((p) => p.type === "rich_text" && /url/i.test(p.name));

  const filesProp = props.find((p) => p.type === "files");

  return {
    databaseId,
    titleProp: titleProp.name,
    toolRelationProp: toolRelationProp.name,
    typeSelectProp: typeSelectProp.name,
    urlProp: urlProp?.name || richTextUrlProp?.name || null,
    urlPropType: urlProp ? "url" : richTextUrlProp ? "rich_text" : null,
    filesProp: filesProp?.name || null,
  };
}

function planForTool(page: NotionPage): PlannedResource[] {
  const plans: PlannedResource[] = [];
  const name = titleOf(page);

  const sop = richTextOf(findProperty(page, ["sop_url", "SOP URL"]));
  if (sop) plans.push({ toolId: page.id, toolName: name, kind: "SOP", title: `${name} — SOP`, url: sop });

  const safety = richTextOf(findProperty(page, ["safety_doc_url", "Safety Doc URL"]));
  if (safety) {
    plans.push({
      toolId: page.id,
      toolName: name,
      kind: "Safety",
      title: `${name} — Safety Doc`,
      url: safety,
    });
  }

  const video = richTextOf(findProperty(page, ["video_url", "Video URL"]));
  if (video) {
    plans.push({ toolId: page.id, toolName: name, kind: "Video", title: `${name} — Video`, url: video });
  }

  for (const manual of filesOf(findProperty(page, ["manual_attachments", "Manuals", "Manual"]))) {
    plans.push({
      toolId: page.id,
      toolName: name,
      kind: "Manual",
      title: manual.filename ? `${name} — ${manual.filename}` : `${name} — Manual`,
      url: manual.url,
    });
  }

  return plans;
}

function existingKey(toolId: string, kind: string, url: string): string {
  return `${toolId} ${kind.toLowerCase()} ${url}`;
}

function indexExistingResources(resources: ResourceRecord[]): Set<string> {
  const set = new Set<string>();
  for (const resource of resources) {
    const kind = resource.fields.type || "Resource";
    const urls: string[] = [];
    if (resource.fields.url) urls.push(resource.fields.url);
    for (const file of resource.fields.files || []) {
      if (file.url) urls.push(file.url);
    }
    for (const toolId of resource.fields.tool || []) {
      for (const url of urls) {
        set.add(existingKey(toolId, kind, url));
      }
    }
  }
  return set;
}

async function createResourcePage(
  schema: ResourcesSchema,
  plan: PlannedResource
): Promise<void> {
  const properties: Record<string, unknown> = {
    [schema.titleProp]: {
      title: [{ type: "text", text: { content: plan.title } }],
    },
    [schema.toolRelationProp]: {
      relation: [{ id: plan.toolId }],
    },
    [schema.typeSelectProp]: {
      select: { name: plan.kind },
    },
  };

  if (plan.kind === "Manual" && schema.filesProp) {
    properties[schema.filesProp] = {
      files: [
        { type: "external", name: plan.title.slice(0, 100), external: { url: plan.url } },
      ],
    };
  } else if (schema.urlProp) {
    properties[schema.urlProp] =
      schema.urlPropType === "url"
        ? { url: plan.url }
        : { rich_text: [{ type: "text", text: { content: plan.url } }] };
  } else if (schema.filesProp) {
    properties[schema.filesProp] = {
      files: [
        { type: "external", name: plan.title.slice(0, 100), external: { url: plan.url } },
      ],
    };
  } else {
    throw new Error("Resources DB has no url or files property to write to");
  }

  await notionFetch("/pages", {
    method: "POST",
    body: JSON.stringify({ parent: { database_id: schema.databaseId }, properties }),
  });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [toolPages, resources, schema] = await Promise.all([
    queryAllToolPages(),
    fetchAllResources(),
    discoverResourcesSchema(),
  ]);

  console.log(`Scanning ${toolPages.length} tools against ${resources.length} existing resources`);
  console.log(
    `Resources DB schema: title="${schema.titleProp}", tool="${schema.toolRelationProp}", type="${schema.typeSelectProp}", url=${schema.urlProp ? `"${schema.urlProp}"(${schema.urlPropType})` : "<none>"}, files=${schema.filesProp ? `"${schema.filesProp}"` : "<none>"}`
  );

  const existing = indexExistingResources(resources);
  const allPlans = toolPages.flatMap(planForTool);
  const toCreate = allPlans.filter(
    (plan) => !existing.has(existingKey(plan.toolId, plan.kind, plan.url))
  );

  console.log("");
  console.log(`Legacy entries found: ${allPlans.length}`);
  console.log(`Already in Resources: ${allPlans.length - toCreate.length}`);
  console.log(`To create: ${toCreate.length}`);

  if (toCreate.length === 0) {
    console.log("\nNothing to migrate.");
    return;
  }

  for (const plan of toCreate) {
    console.log(`  [${plan.kind}] ${plan.toolName} → ${plan.url}`);
  }

  if (!apply) {
    console.log("\nDry run — pass --apply to write these rows to Notion.");
    return;
  }

  console.log("\nWriting...");
  let created = 0;
  for (const plan of toCreate) {
    try {
      await createResourcePage(schema, plan);
      created += 1;
      console.log(`  ✔ [${plan.kind}] ${plan.toolName}`);
    } catch (error) {
      console.error(`  ✘ [${plan.kind}] ${plan.toolName}: ${error instanceof Error ? error.message : error}`);
    }
  }
  console.log(`\nDone — ${created}/${toCreate.length} rows created.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
