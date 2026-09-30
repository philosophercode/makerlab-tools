// Clears the legacy "Migrated from Airtable." string from the Resources.notes
// field on every row where it appears. Reads raw Notion pages so the matching
// is exact rather than going through our app types.
//
// Dry-run by default. Pass --apply to actually update Notion.

export {};

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

// Strings that signal the row's notes are nothing more than a migration tag.
const STALE_NOTES = [
  "Migrated from Airtable",
  "Migrated from Airtable.",
];

interface NotionRichText {
  plain_text?: string;
}

interface NotionProperty {
  type: string;
  rich_text?: NotionRichText[];
  title?: NotionRichText[];
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

interface DatabaseSchemaResponse {
  properties: Record<string, { id: string; name: string; type: string }>;
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

async function queryAllResourcePages(databaseId: string): Promise<NotionPage[]> {
  const pages: NotionPage[] = [];
  let cursor: string | undefined;
  do {
    const data = await notionFetch<NotionQueryResponse>(`/databases/${databaseId}/query`, {
      method: "POST",
      body: JSON.stringify({
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });
    pages.push(...data.results);
    cursor = data.next_cursor || undefined;
  } while (cursor);
  return pages;
}

function richTextString(property?: NotionProperty): string {
  if (!property || property.type !== "rich_text") return "";
  return property.rich_text?.map((part) => part.plain_text || "").join("") || "";
}

function titleString(page: NotionPage): string {
  const titleProperty = Object.values(page.properties).find((p) => p.type === "title");
  return titleProperty?.title?.map((part) => part.plain_text || "").join("") || "(untitled)";
}

function findNotesProperty(
  schema: DatabaseSchemaResponse
): { name: string } | null {
  for (const property of Object.values(schema.properties)) {
    if (property.type !== "rich_text") continue;
    if (/notes?/i.test(property.name)) return { name: property.name };
  }
  return null;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const databaseId = requireEnv("NOTION_DB_RESOURCES");

  const schema = await notionFetch<DatabaseSchemaResponse>(`/databases/${databaseId}`);
  const notesProp = findNotesProperty(schema);
  if (!notesProp) {
    console.error("Could not locate a notes column on the Resources DB.");
    process.exitCode = 1;
    return;
  }

  console.log(apply ? "APPLY mode — Notion will be mutated." : "Dry run — pass --apply to clear notes.");
  console.log(`Notes column: "${notesProp.name}"\n`);

  const pages = await queryAllResourcePages(databaseId);
  const targets = pages.filter((page) => {
    const value = richTextString(page.properties[notesProp.name]).trim();
    return STALE_NOTES.includes(value);
  });

  console.log(`Resources scanned: ${pages.length}`);
  console.log(`Rows with stale migration notes: ${targets.length}\n`);

  if (targets.length === 0) {
    console.log("Nothing to clear.");
    return;
  }

  for (const page of targets) {
    console.log(`  ${titleString(page)}`);
  }

  if (!apply) {
    console.log("\nDry run complete. Re-run with --apply to clear these.");
    return;
  }

  console.log("\nClearing...");
  let cleared = 0;
  for (const page of targets) {
    try {
      await notionFetch(`/pages/${page.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          properties: {
            [notesProp.name]: { rich_text: [] },
          },
        }),
      });
      cleared += 1;
      console.log(`  ✔ ${titleString(page)}`);
    } catch (error) {
      console.error(
        `  ✘ ${titleString(page)}: ${error instanceof Error ? error.message : error}`
      );
    }
  }
  console.log(`\nDone — ${cleared}/${targets.length} rows updated.`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
