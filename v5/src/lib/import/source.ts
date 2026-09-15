import {
  fetchAllProjects,
  getDatabaseSchema,
  hasProjectsEnv,
  pageToCategory,
  pageToFlag,
  pageToLocation,
  pageToMaintenanceLog,
  pageToResource,
  pageToTool,
  pageToUnit,
  queryAllPages,
  readEmailProperty,
  type CatalogTable,
} from "../notion.ts";
import type {
  CategoryRecord,
  LocationRecord,
  ProjectRecord,
  ResourceRecord,
  ToolRecord,
  UnitRecord,
} from "../types.ts";
import type { FlagImportRecord, MaintenanceImportRecord } from "./mappers.ts";
import type { SchemasByTable } from "./preflight.ts";

/**
 * Everything the import needs from Notion, read once (spec §5.7 step 2).
 *
 * Read-only against Notion, drafts included, throttled to stay under the API's
 * rate limit. The result is a plain object so the run can be tested without
 * Notion and the same snapshot can feed a dry run and then the real one.
 */
export interface NotionSnapshot {
  schemas: SchemasByTable;
  categories: CategoryRecord[];
  locations: LocationRecord[];
  tools: ToolRecord[];
  units: UnitRecord[];
  resources: ResourceRecord[];
  maintenanceLogs: MaintenanceImportRecord[];
  flags: FlagImportRecord[];
  projects: ProjectRecord[];
}

export interface ReadSnapshotOptions {
  /** Pause between Notion requests; 350 ms keeps under 3 requests per second. */
  throttleMs?: number;
  log?: (line: string) => void;
}

const SCHEMA_TABLES: Array<keyof SchemasByTable> = ["units", "maintenance_logs", "flags"];

export async function readNotionSnapshot(options: ReadSnapshotOptions = {}): Promise<NotionSnapshot> {
  const throttleMs = options.throttleMs ?? 350;
  const log = options.log ?? (() => {});
  const pause = () => new Promise((resolve) => setTimeout(resolve, throttleMs));

  const schemas: SchemasByTable = {};
  for (const table of SCHEMA_TABLES) {
    schemas[table] = await getDatabaseSchema(table);
    await pause();
  }

  const read = async (table: CatalogTable) => {
    const pages = await queryAllPages(table, { throttleMs });
    log(`read ${pages.length} ${table}`);
    await pause();
    return pages;
  };

  const categories = (await read("categories")).map(pageToCategory);
  const locations = (await read("locations")).map(pageToLocation);
  const tools = (await read("tools")).map(pageToTool);
  const units = (await read("units")).map(pageToUnit);
  const resources = (await read("resources")).map(pageToResource);
  const maintenanceLogs = (await read("maintenance_logs")).map((page) => ({
    ...pageToMaintenanceLog(page),
    reporterEmail: readEmailProperty(page, ["reporter_email", "Reporter Email"]) || null,
  }));
  const flags = (await read("flags")).map((page) => ({
    ...pageToFlag(page),
    reporterEmail: readEmailProperty(page, ["reporter_email", "Reporter Email"]) || null,
  }));

  const projects = hasProjectsEnv() ? await fetchAllProjects() : [];
  log(`read ${projects.length} projects${hasProjectsEnv() ? "" : " (NOTION_DB_PROJECTS unset)"}`);

  return { schemas, categories, locations, tools, units, resources, maintenanceLogs, flags, projects };
}
