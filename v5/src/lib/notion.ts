import type {
  Attachment,
  CategoryFields,
  CategoryRecord,
  LocationFields,
  LocationRecord,
  NotionRecord,
  ResourceFields,
  ResourceRecord,
  ToolFields,
  ToolRecord,
  ToolWithMeta,
  UnitFields,
  UnitRecord,
} from "./types";

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

type CatalogTable =
  | "tools"
  | "categories"
  | "locations"
  | "units"
  | "resources"
  | "maintenance_logs"
  | "flags";

type NotionEnv = {
  apiKey: string;
  databases: Record<CatalogTable, string>;
};

type NotionRichText = {
  plain_text?: string;
};

type NotionFile = {
  name?: string;
  type?: "file" | "external";
  file?: { url?: string };
  external?: { url?: string };
};

type NotionProperty = {
  type: string;
  title?: NotionRichText[];
  rich_text?: NotionRichText[];
  select?: { name?: string } | null;
  multi_select?: { name?: string }[];
  relation?: { id: string }[];
  checkbox?: boolean;
  url?: string | null;
  files?: NotionFile[];
  date?: { start?: string } | null;
  number?: number | null;
};

type NotionPage = {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  properties: Record<string, NotionProperty>;
};

type NotionQueryResponse = {
  results: NotionPage[];
  has_more: boolean;
  next_cursor?: string | null;
};

type QueryBody = {
  page_size?: number;
  start_cursor?: string;
  filter?: unknown;
  sorts?: { property: string; direction: "ascending" | "descending" }[];
};

const ENV_KEYS: Record<CatalogTable, string> = {
  tools: "NOTION_DB_TOOLS",
  categories: "NOTION_DB_CATEGORIES",
  locations: "NOTION_DB_LOCATIONS",
  units: "NOTION_DB_UNITS",
  resources: "NOTION_DB_RESOURCES",
  maintenance_logs: "NOTION_DB_MAINTENANCE_LOGS",
  flags: "NOTION_DB_FLAGS",
};

function getNotionEnv(): NotionEnv {
  const apiKey = process.env.NOTION_API_KEY;
  const databases = Object.fromEntries(
    Object.entries(ENV_KEYS).map(([table, key]) => [table, process.env[key]])
  ) as Partial<Record<CatalogTable, string>>;

  const missing = [
    !apiKey ? "NOTION_API_KEY" : null,
    ...Object.entries(ENV_KEYS)
      .filter(([table]) => !databases[table as CatalogTable])
      .map(([, key]) => key),
  ].filter(Boolean);

  if (missing.length > 0) {
    throw new Error(`Missing Notion catalog env vars: ${missing.join(", ")}`);
  }

  return {
    apiKey: apiKey as string,
    databases: databases as Record<CatalogTable, string>,
  };
}

export function getNotionEnvContract(): string[] {
  return ["NOTION_API_KEY", ...Object.values(ENV_KEYS)];
}

async function notionFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { apiKey } = getNotionEnv();
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
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function queryDatabase(
  table: CatalogTable,
  body: QueryBody = {}
): Promise<NotionPage[]> {
  const { databases } = getNotionEnv();
  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const data = await notionFetch<NotionQueryResponse>(
      `/databases/${databases[table]}/query`,
      {
        method: "POST",
        body: JSON.stringify({
          page_size: 100,
          ...body,
          ...(startCursor ? { start_cursor: startCursor } : {}),
        }),
      }
    );

    pages.push(...data.results);
    startCursor = data.next_cursor || undefined;
  } while (startCursor);

  return pages;
}

async function fetchPage(id: string): Promise<NotionPage> {
  return notionFetch<NotionPage>(`/pages/${id}`);
}

function prop(page: NotionPage, names: string[]): NotionProperty | undefined {
  return names.map((name) => page.properties[name]).find(Boolean);
}

function title(page: NotionPage, names: string[]): string {
  return richTextValue(prop(page, names));
}

function richTextValue(property?: NotionProperty): string {
  if (!property) return "";
  if (property.type === "title") {
    return property.title?.map((part) => part.plain_text || "").join("") || "";
  }
  if (property.type === "rich_text") {
    return property.rich_text?.map((part) => part.plain_text || "").join("") || "";
  }
  if (property.type === "select") return property.select?.name || "";
  if (property.type === "url") return property.url || "";
  if (property.type === "date") return property.date?.start || "";
  return "";
}

function selectValue(page: NotionPage, names: string[]): string {
  const property = prop(page, names);
  if (!property) return "";
  if (property.type === "select") return property.select?.name || "";
  return richTextValue(property);
}

function multiSelectValue(page: NotionPage, names: string[]): string[] {
  const property = prop(page, names);
  if (!property) return [];
  if (property.type === "multi_select") {
    return property.multi_select?.map((item) => item.name || "").filter(Boolean) || [];
  }
  const value = richTextValue(property);
  return value ? value.split(",").map((item) => item.trim()).filter(Boolean) : [];
}

function relationIds(page: NotionPage, names: string[]): string[] {
  const property = prop(page, names);
  return property?.type === "relation"
    ? property.relation?.map((relation) => relation.id) || []
    : [];
}

function checkboxValue(page: NotionPage, names: string[]): boolean | undefined {
  const property = prop(page, names);
  return property?.type === "checkbox" ? property.checkbox : undefined;
}

const STALE_IMAGE_HOSTS = ["airtableusercontent.com"];

function isStaleImageUrl(url: string | undefined): boolean {
  if (!url) return true;
  return STALE_IMAGE_HOSTS.some((host) => url.includes(host));
}

function pickFreshImageUrl(attachment: Attachment | undefined): string | null {
  if (!attachment) return null;
  const candidates = [attachment.thumbnails?.large?.url, attachment.url];
  return candidates.find((candidate) => candidate && !isStaleImageUrl(candidate)) || null;
}

function fileAttachments(page: NotionPage, names: string[]): Attachment[] {
  const property = prop(page, names);
  if (property?.type !== "files") return [];

  return (property.files || []).flatMap((file, index) => {
    const url = file.type === "external" ? file.external?.url : file.file?.url;
    if (!url) return [];
    const filename = file.name || url.split("/").pop() || `notion-file-${index + 1}`;
    return {
      id: `${page.id}:${names[0]}:${index}`,
      url,
      filename,
      size: 0,
      type: "application/octet-stream",
    };
  });
}

function record<T>(page: NotionPage, fields: T): NotionRecord<T> {
  return {
    id: page.id,
    createdTime: page.created_time,
    lastEditedTime: page.last_edited_time,
    fields,
  };
}

function pageToCategory(page: NotionPage): CategoryRecord {
  return record<CategoryFields>(page, {
    name: title(page, ["name", "Name"]),
    group: selectValue(page, ["group", "Group"]),
  });
}

function pageToLocation(page: NotionPage): LocationRecord {
  return record<LocationFields>(page, {
    id: title(page, ["id", "ID", "Name"]),
    zone: selectValue(page, ["zone", "Zone", "name", "Name"]),
    room: selectValue(page, ["room", "Room"]),
  });
}

function pageToTool(page: NotionPage): ToolRecord {
  return record<ToolFields>(page, {
    name: title(page, ["name", "Name"]),
    description: richTextValue(prop(page, ["description", "Description"])),
    category: relationIds(page, ["category", "Category"]),
    location: relationIds(page, ["location", "Location"]),
    materials: multiSelectValue(page, ["materials", "Materials"]),
    ppe_required: multiSelectValue(page, ["ppe_required", "PPE Required", "PPE"]),
    tags: multiSelectValue(page, ["tags", "Tags"]),
    training_required: checkboxValue(page, ["training_required", "Training Required"]),
    use_restrictions: richTextValue(prop(page, ["use_restrictions", "Use Restrictions"])),
    emergency_stop: richTextValue(prop(page, ["emergency_stop", "Emergency Stop"])),
    image_attachments: fileAttachments(page, ["image_attachments", "Images", "Image"]),
    notes: richTextValue(prop(page, ["notes", "Notes"])),
    published: checkboxValue(page, ["published", "Published"]),
  });
}

function pageToUnit(page: NotionPage): UnitRecord {
  return record<UnitFields>(page, {
    unit_label: title(page, ["unit_label", "Unit Label", "Name"]),
    tool: relationIds(page, ["tool", "Tool"]),
    serial_number: richTextValue(prop(page, ["serial_number", "Serial Number"])),
    asset_tag: richTextValue(prop(page, ["asset_tag", "Asset Tag"])),
    status: selectValue(page, ["status", "Status"]) as UnitFields["status"],
    condition: selectValue(page, ["condition", "Condition"]) as UnitFields["condition"],
    date_acquired: richTextValue(prop(page, ["date_acquired", "Date Acquired"])),
    notes: richTextValue(prop(page, ["notes", "Notes"])),
  });
}

function pageToResource(page: NotionPage): ResourceRecord {
  return record<ResourceFields>(page, {
    title: title(page, ["title", "Title", "name", "Name"]),
    tool: relationIds(page, ["tool", "Tool"]),
    type: selectValue(page, ["type", "Type", "kind", "Kind"]),
    url: richTextValue(prop(page, ["url", "URL"])),
    files: fileAttachments(page, ["files", "Files", "attachments", "Attachments"]),
    notes: richTextValue(prop(page, ["notes", "Notes"])),
    published: checkboxValue(page, ["published", "Published"]),
  });
}

export async function fetchAllTools(): Promise<ToolRecord[]> {
  const sortByName = [{ property: "name", direction: "ascending" as const }];
  const withPublishedFilter = (property: string): QueryBody => ({
    filter: { property, checkbox: { equals: true } },
    sorts: sortByName,
  });

  const pages = await queryDatabase("tools", withPublishedFilter("published"))
    .catch(() => queryDatabase("tools", withPublishedFilter("Published")))
    .catch(() => queryDatabase("tools", { sorts: sortByName }))
    .catch(() => queryDatabase("tools"));

  return pages.map(pageToTool);
}

export async function fetchTool(id: string): Promise<ToolRecord> {
  return pageToTool(await fetchPage(id));
}

export async function fetchAllCategories(): Promise<CategoryRecord[]> {
  const pages = await queryDatabase("categories", {
    sorts: [{ property: "group", direction: "ascending" }],
  }).catch(() => queryDatabase("categories"));
  return pages.map(pageToCategory);
}

export async function fetchAllLocations(): Promise<LocationRecord[]> {
  const pages = await queryDatabase("locations", {
    sorts: [{ property: "room", direction: "ascending" }],
  }).catch(() => queryDatabase("locations"));
  return pages.map(pageToLocation);
}

export async function fetchAllUnits(): Promise<UnitRecord[]> {
  const pages = await queryDatabase("units", {
    sorts: [{ property: "unit_label", direction: "ascending" }],
  }).catch(() => queryDatabase("units"));
  return pages.map(pageToUnit);
}

export async function fetchAllResources(): Promise<ResourceRecord[]> {
  const pages = await queryDatabase("resources", {
    sorts: [{ property: "title", direction: "ascending" }],
  })
    .catch(() => queryDatabase("resources", { sorts: [{ property: "Title", direction: "ascending" }] }))
    .catch(() => queryDatabase("resources"));
  return pages.map(pageToResource);
}

export async function fetchUnit(id: string): Promise<UnitRecord> {
  return pageToUnit(await fetchPage(id));
}

export function resolveTools(
  tools: ToolRecord[],
  categories: CategoryRecord[],
  locations: LocationRecord[]
): ToolWithMeta[] {
  const catMap = new Map(categories.map((category) => [category.id, category.fields]));
  const locMap = new Map(locations.map((location) => [location.id, location.fields]));

  return tools.map((tool) => {
    const category = tool.fields.category?.[0]
      ? catMap.get(tool.fields.category[0])
      : undefined;
    const location = tool.fields.location?.[0]
      ? locMap.get(tool.fields.location[0])
      : undefined;
    const firstImage = tool.fields.image_attachments?.[0];

    return {
      id: tool.id,
      name: tool.fields.name,
      description: tool.fields.description || "",
      category_group: category?.group || "Uncategorized",
      category_sub: category?.name || "Other",
      location_room: location?.room || "Unknown",
      location_zone: location?.zone || "Unknown",
      materials: tool.fields.materials || [],
      ppe_required: tool.fields.ppe_required || [],
      tags: tool.fields.tags || [],
      authorized_only: false,
      training_required: tool.fields.training_required || false,
      use_restrictions: tool.fields.use_restrictions || null,
      emergency_stop: tool.fields.emergency_stop || null,
      notes: tool.fields.notes || null,
      map_tag: location?.id || null,
      image_url: pickFreshImageUrl(firstImage),
      image_attachments: tool.fields.image_attachments || [],
    };
  });
}

