// Drop deprecated columns from the Notion catalog databases.
// Tools: sop_url, safety_doc_url, video_url, manual_attachments
// Resources: content, sort_order, source
// Units: uuid
//
// Dry-run by default. Pass --apply to actually mutate Notion.

export {};

const NOTION_API_URL = "https://api.notion.com/v1";
const NOTION_VERSION = "2022-06-28";

interface DatabaseProperty {
  id: string;
  name: string;
  type: string;
}

interface DatabaseResponse {
  id: string;
  properties: Record<string, DatabaseProperty>;
}

interface DropTarget {
  table: "Tools" | "Resources" | "Units";
  envKey: string;
  // Each entry is a list of accepted names for one deprecated column.
  columns: Array<{ logical: string; aliases: string[] }>;
}

const TARGETS: DropTarget[] = [
  {
    table: "Tools",
    envKey: "NOTION_DB_TOOLS",
    columns: [
      { logical: "sop_url", aliases: ["sop_url", "SOP URL"] },
      { logical: "safety_doc_url", aliases: ["safety_doc_url", "Safety Doc URL"] },
      { logical: "video_url", aliases: ["video_url", "Video URL"] },
      { logical: "manual_attachments", aliases: ["manual_attachments", "Manuals", "Manual"] },
    ],
  },
  {
    table: "Resources",
    envKey: "NOTION_DB_RESOURCES",
    columns: [
      { logical: "content", aliases: ["content", "Content"] },
      { logical: "sort_order", aliases: ["sort_order", "Sort Order"] },
      { logical: "source", aliases: ["source", "Source"] },
    ],
  },
  {
    table: "Units",
    envKey: "NOTION_DB_UNITS",
    columns: [{ logical: "uuid", aliases: ["uuid", "UUID"] }],
  },
];

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

function findProperty(
  db: DatabaseResponse,
  aliases: string[]
): DatabaseProperty | undefined {
  for (const alias of aliases) {
    if (db.properties[alias]) return db.properties[alias];
  }
  return undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  console.log(apply ? "APPLY mode — Notion will be mutated.\n" : "Dry run — pass --apply to mutate Notion.\n");

  for (const target of TARGETS) {
    const databaseId = requireEnv(target.envKey);
    const db = await notionFetch<DatabaseResponse>(`/databases/${databaseId}`);

    console.log(`${target.table} (${target.envKey} = ${databaseId})`);

    const found: DatabaseProperty[] = [];
    for (const col of target.columns) {
      const property = findProperty(db, col.aliases);
      if (property) {
        found.push(property);
        console.log(`  ✔ found "${property.name}" (type=${property.type}, id=${property.id})`);
      } else {
        console.log(`  · ${col.logical} not present — skipping`);
      }
    }

    if (found.length === 0) {
      console.log("");
      continue;
    }

    if (!apply) {
      console.log(`  → would PATCH database to drop ${found.length} columns\n`);
      continue;
    }

    const properties: Record<string, null> = {};
    for (const property of found) {
      properties[property.id] = null;
    }

    try {
      await notionFetch(`/databases/${databaseId}`, {
        method: "PATCH",
        body: JSON.stringify({ properties }),
      });
      console.log(`  → dropped ${found.length} columns\n`);
    } catch (error) {
      console.error(`  → FAILED: ${error instanceof Error ? error.message : error}\n`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
