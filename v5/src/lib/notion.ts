import type {
  Attachment,
  CategoryFields,
  CategoryRecord,
  LocationFields,
  LocationRecord,
  MaintenanceLogFields,
  MaintenanceLogRecord,
  MaintenancePriority,
  MaintenanceStatus,
  MaintenanceType,
  NotionRecord,
  ProjectFields,
  ProjectRecord,
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

function urlValue(property?: NotionProperty): string {
  return property?.type === "url" ? property.url ?? "" : "";
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
    url: urlValue(prop(page, ["url", "URL"])),
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

function dateValue(page: NotionPage, names: string[]): string {
  const property = prop(page, names);
  if (property?.type === "date") return property.date?.start || "";
  return richTextValue(property);
}

function pageToMaintenanceLog(page: NotionPage): MaintenanceLogRecord {
  return record<MaintenanceLogFields>(page, {
    title: title(page, ["title", "Title", "name", "Name"]),
    unit: relationIds(page, ["unit", "Unit"]),
    type: (selectValue(page, ["type", "Type"]) || undefined) as MaintenanceType | undefined,
    priority: (selectValue(page, ["priority", "Priority"]) || undefined) as
      | MaintenancePriority
      | undefined,
    status: (selectValue(page, ["status", "Status"]) || undefined) as
      | MaintenanceStatus
      | undefined,
    reported_by: richTextValue(prop(page, ["reported_by", "Reported By"])),
    assigned_to: richTextValue(prop(page, ["assigned_to", "Assigned To"])),
    description: richTextValue(prop(page, ["description", "Description"])),
    resolution: richTextValue(prop(page, ["resolution", "Resolution"])),
    date_reported: dateValue(page, ["date_reported", "Date Reported"]),
    date_resolved: dateValue(page, ["date_resolved", "Date Resolved"]),
    photo_attachments: fileAttachments(page, [
      "photo_attachments",
      "Photo Attachments",
      "Photos",
    ]),
  });
}

export async function fetchMaintenanceLogsByUnit(
  unitId: string
): Promise<MaintenanceLogRecord[]> {
  const pages = await queryDatabase("maintenance_logs", {
    filter: {
      property: "unit",
      relation: { contains: unitId },
    },
    sorts: [{ property: "date_reported", direction: "descending" }],
  })
    .catch(() =>
      queryDatabase("maintenance_logs", {
        filter: {
          property: "Unit",
          relation: { contains: unitId },
        },
        sorts: [{ property: "Date Reported", direction: "descending" }],
      })
    )
    .catch(() => queryDatabase("maintenance_logs"));

  return pages
    .map(pageToMaintenanceLog)
    .filter((log) => log.fields.unit?.includes(unitId));
}

type NotionWriteFile = {
  type: "file_upload";
  file_upload: { id: string };
  name: string;
};

type NotionWriteProperty =
  | { title: { text: { content: string } }[] }
  | { rich_text: { text: { content: string } }[] }
  | { select: { name: string } | null }
  | { multi_select: { name: string }[] }
  | { relation: { id: string }[] }
  | { date: { start: string } | null }
  | { url: string | null }
  | { checkbox: boolean }
  | { files: NotionWriteFile[] };

function titleProp(value: string): NotionWriteProperty {
  return { title: [{ text: { content: value } }] };
}

function richTextProp(value: string): NotionWriteProperty {
  return { rich_text: [{ text: { content: value } }] };
}

function selectProp(value: string | undefined): NotionWriteProperty {
  return value ? { select: { name: value } } : { select: null };
}

function relationProp(ids: string[] | undefined): NotionWriteProperty {
  return { relation: (ids || []).map((id) => ({ id })) };
}

function dateProp(value: string | undefined): NotionWriteProperty {
  return value ? { date: { start: value } } : { date: null };
}

function formatTicketDescription(
  fields: Partial<MaintenanceLogFields>
): string {
  const sections: string[] = [];
  if (fields.description) {
    sections.push(`**What happened**\n${fields.description}`);
  }
  if (fields.reported_by) {
    sections.push(`**Reported by**\n${fields.reported_by}`);
  }
  if (fields.date_reported) {
    sections.push(`**Date reported**\n${fields.date_reported}`);
  }
  if (fields.priority) {
    sections.push(`**Priority**\n${fields.priority}`);
  }
  return sections.join("\n\n");
}

function fileUploadsProp(
  uploads: Array<{ id: string; name: string }> | undefined
): NotionWriteProperty {
  return {
    files: (uploads || []).map((u) => ({
      type: "file_upload" as const,
      file_upload: { id: u.id },
      name: u.name,
    })),
  };
}


export async function createMaintenanceLog(
  fields: Partial<MaintenanceLogFields>
): Promise<MaintenanceLogRecord> {
  const { databases } = getNotionEnv();
  const properties: Record<string, NotionWriteProperty> = {
    title: titleProp(fields.title || "Untitled issue"),
  };
  if (fields.unit?.length) properties.unit = relationProp(fields.unit);
  if (fields.type) properties.type = selectProp(fields.type);
  if (fields.priority) properties.priority = selectProp(fields.priority);
  if (fields.status) properties.status = selectProp(fields.status);
  if (fields.reported_by) properties.reported_by = richTextProp(fields.reported_by);
  const templatedDescription = formatTicketDescription(fields);
  if (templatedDescription) {
    properties.description = richTextProp(templatedDescription);
  }
  if (fields.date_reported) properties.date_reported = dateProp(fields.date_reported);
  if (fields.photo_uploads?.length) {
    properties.photo_attachments = fileUploadsProp(fields.photo_uploads);
  }

  const page = await notionFetch<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: databases.maintenance_logs },
      properties,
    }),
  });

  return pageToMaintenanceLog(page);
}

// ---------------------------------------------------------------------------
// Projects (Student Projects Gallery)
//
// The Projects DB is optional and independent of the catalog env contract:
// `NOTION_DB_PROJECTS` may be unset without breaking the rest of the catalog,
// and these helpers only need `NOTION_API_KEY` + that single DB id. So they
// avoid `getNotionEnv()` (which is strict about all catalog tables).
// ---------------------------------------------------------------------------

export function getProjectsDbId(): string | undefined {
  return process.env.NOTION_DB_PROJECTS || undefined;
}

export function hasProjectsEnv(): boolean {
  return Boolean(process.env.NOTION_API_KEY && getProjectsDbId());
}

async function projectsRequest<T>(
  path: string,
  init?: RequestInit
): Promise<T> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) throw new Error("Missing NOTION_API_KEY");

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
    return projectsRequest<T>(path, init);
  }

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Notion API ${res.status}: ${body}`);
  }

  return res.json() as Promise<T>;
}

async function queryProjectsDb(body: QueryBody = {}): Promise<NotionPage[]> {
  const dbId = getProjectsDbId();
  if (!dbId) return [];

  const pages: NotionPage[] = [];
  let startCursor: string | undefined;

  do {
    const data = await projectsRequest<NotionQueryResponse>(
      `/databases/${dbId}/query`,
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

export function pageToProject(page: NotionPage): ProjectRecord {
  return record<ProjectFields>(page, {
    title: title(page, ["title", "Title", "name", "Name"]),
    author: richTextValue(prop(page, ["author", "Author"])),
    body: richTextValue(prop(page, ["body", "Body"])),
    photos: fileAttachments(page, ["photos", "Photos", "images", "Images"]),
    tools_used: relationIds(page, ["tools_used", "Tools Used", "tools", "Tools"]),
    link: urlValue(prop(page, ["link", "Link", "url", "URL"])),
    materials: multiSelectValue(page, ["materials", "Materials"]),
    published: checkboxValue(page, ["published", "Published"]),
    // created_time lives on the page envelope, not in a typed property here.
    date: page.created_time,
  });
}

export async function fetchAllProjects(
  options: { publishedOnly?: boolean } = {}
): Promise<ProjectRecord[]> {
  const sortByDate = [
    { property: "date", direction: "descending" as const },
  ];

  // The `date` property is a created_time field; if it's named differently the
  // sort silently falls back to unsorted (then JS-sorted below).
  const pages = await queryProjectsDb({ sorts: sortByDate })
    .catch(() => queryProjectsDb({ sorts: [{ property: "Date", direction: "descending" }] }))
    .catch(() => queryProjectsDb());

  const projects = pages
    .map(pageToProject)
    .sort((a, b) => (b.fields.date || "").localeCompare(a.fields.date || ""));

  if (options.publishedOnly) {
    return projects.filter((project) => project.fields.published === true);
  }
  return projects;
}

export async function fetchProject(id: string): Promise<ProjectRecord> {
  return pageToProject(await projectsRequest<NotionPage>(`/pages/${id}`));
}

export async function createProject(
  fields: Partial<ProjectFields>
): Promise<ProjectRecord> {
  const dbId = getProjectsDbId();
  if (!dbId) throw new Error("Missing NOTION_DB_PROJECTS");

  const properties: Record<string, NotionWriteProperty> = {
    title: titleProp(fields.title || "Untitled project"),
    // Submissions always land unpublished; staff flip this in Notion.
    published: { checkbox: false },
  };
  if (fields.author) properties.author = richTextProp(fields.author);
  if (fields.body) properties.body = richTextProp(fields.body);
  if (fields.tools_used?.length) {
    properties.tools_used = relationProp(fields.tools_used);
  }
  if (fields.link) properties.link = { url: fields.link };
  if (fields.materials?.length) {
    properties.materials = {
      multi_select: fields.materials.map((name) => ({ name })),
    };
  }
  if (fields.photo_uploads?.length) {
    properties.photos = fileUploadsProp(fields.photo_uploads);
  }

  const page = await projectsRequest<NotionPage>("/pages", {
    method: "POST",
    body: JSON.stringify({
      parent: { database_id: dbId },
      properties,
    }),
  });

  return pageToProject(page);
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

