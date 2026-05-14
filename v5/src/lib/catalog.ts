import { cacheLife, cacheTag } from "next/cache";
import {
  fetchAllCategories,
  fetchAllLocations,
  fetchAllResources,
  fetchAllTools,
  fetchAllUnits,
  getNotionEnvContract,
  resolveTools,
} from "./notion";
import type {
  CategoryRecord,
  LocationRecord,
  ResourceRecord,
  ToolRecord,
  ToolWithMeta,
  UnitRecord,
} from "./types";
import type {
  CatalogStats,
  MakerLabTool,
  MakerLabUnit,
  ToolStatus,
} from "../components/catalog-types";
import { getToolBySlug, mockTools } from "../components/mock-catalog";

interface FullCatalog {
  tools: ToolRecord[];
  categories: CategoryRecord[];
  locations: LocationRecord[];
  units: UnitRecord[];
  resources: ResourceRecord[];
}

export function hasNotionCatalogEnv(): boolean {
  return getNotionEnvContract().every((key) => Boolean(process.env[key]));
}

async function fetchFullCatalog(): Promise<FullCatalog> {
  "use cache";
  cacheTag("catalog");
  cacheLife("hours");

  const [tools, categories, locations, units, resources] = await Promise.all([
    fetchAllTools(),
    fetchAllCategories(),
    fetchAllLocations(),
    fetchAllUnits(),
    fetchAllResources(),
  ]);
  return { tools, categories, locations, units, resources };
}

function groupUnitsByTool(units: UnitRecord[]): Map<string, UnitRecord[]> {
  const map = new Map<string, UnitRecord[]>();
  for (const unit of units) {
    for (const toolId of unit.fields.tool || []) {
      const list = map.get(toolId);
      if (list) list.push(unit);
      else map.set(toolId, [unit]);
    }
  }
  return map;
}

function groupResourcesByTool(resources: ResourceRecord[]): Map<string, ResourceRecord[]> {
  const map = new Map<string, ResourceRecord[]>();
  for (const resource of resources) {
    if (resource.fields.published === false) continue;
    for (const toolId of resource.fields.tool || []) {
      const list = map.get(toolId);
      if (list) list.push(resource);
      else map.set(toolId, [resource]);
    }
  }
  return map;
}

export async function getCatalogTools(): Promise<MakerLabTool[]> {
  if (!hasNotionCatalogEnv()) return mockTools;

  try {
    const catalog = await fetchFullCatalog();
    const resolved = resolveTools(catalog.tools, catalog.categories, catalog.locations);
    const unitsByTool = groupUnitsByTool(catalog.units);
    const resourcesByTool = groupResourcesByTool(catalog.resources);

    return resolved.map((tool) =>
      toMakerLabTool(tool, unitsByTool.get(tool.id) || [], resourcesByTool.get(tool.id) || [])
    );
  } catch (error) {
    console.warn("Falling back to mock catalog:", error);
    return mockTools;
  }
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const tools = await getCatalogTools();

  return {
    toolsInInventory: tools.length,
    labHours: "LAB OPEN 9AM-9PM",
  };
}

export async function getCatalogTool(id: string): Promise<MakerLabTool | null> {
  if (!hasNotionCatalogEnv()) {
    return getToolBySlug(id) || null;
  }

  try {
    const catalog = await fetchFullCatalog();
    const raw = catalog.tools.find((tool) => tool.id === id);
    if (!raw) return null;

    const [resolved] = resolveTools([raw], catalog.categories, catalog.locations);
    if (!resolved) return null;

    const units = groupUnitsByTool(catalog.units).get(id) || [];
    const resources = groupResourcesByTool(catalog.resources).get(id) || [];
    return toMakerLabTool(resolved, units, resources);
  } catch (error) {
    console.warn("Falling back to mock tool:", error);
    return getToolBySlug(id) || null;
  }
}

function toMakerLabTool(
  tool: ToolWithMeta,
  units: UnitRecord[],
  resources: ResourceRecord[] = []
): MakerLabTool {
  const mappedUnits = units.map((unit) => toMakerLabUnit(unit, tool));
  const status = deriveStatus(tool, mappedUnits);

  return {
    id: tool.id,
    slug: tool.id,
    name: tool.name,
    category: tool.category_group,
    categorySub: tool.category_sub,
    location: tool.location_room,
    zone: tool.location_zone,
    trainingLevel: deriveTrainingLevel(tool),
    trainingLabel: deriveTrainingLabel(tool),
    status,
    shortDescription: tool.description || "Catalog record pending description.",
    description: tool.description || "This tool record is available in the MakerLab catalog.",
    imageSrc: tool.image_url || localToolImage(tool.name),
    ppe: tool.ppe_required.length ? tool.ppe_required : ["Check posted lab guidance"],
    materials: tool.materials,
    tags: tool.tags,
    emergencyStop: tool.emergency_stop,
    useRestrictions: tool.use_restrictions,
    mapId: tool.map_tag,
    notes: tool.notes,
    links: resourceLinks(resources),
    units: mappedUnits,
  };
}

function resourceLinks(resources: ResourceRecord[]): MakerLabTool["links"] {
  return resources.flatMap((resource) => {
    const fields = resource.fields;
    const base = {
      kind: fields.type || "Resource",
      description: fields.notes || undefined,
    };
    const urlLinks = fields.url
      ? [
          {
            label: fields.title || fields.type || "Resource",
            href: fields.url,
            ...base,
          },
        ]
      : [];
    const fileLinks =
      fields.files?.map((file) => ({
        label: fields.title || file.filename || fields.type || "Resource",
        href: file.url,
        ...base,
      })) || [];

    return [...urlLinks, ...fileLinks];
  });
}

function toMakerLabUnit(unit: UnitRecord, tool: ToolWithMeta): MakerLabUnit {
  return {
    id: unit.id,
    name: unit.fields.unit_label || `${tool.name} // Unit`,
    serial: unit.fields.serial_number || unit.fields.asset_tag || "Unlisted",
    status: toToolStatus(unit.fields.status, false),
    condition: toCondition(unit.fields.condition, unit.fields.status),
    location: tool.location_zone || tool.location_room || "Unknown",
    dateAcquired: unit.fields.date_acquired || null,
  };
}

function deriveStatus(tool: ToolWithMeta, units: MakerLabUnit[]): ToolStatus {
  if (units.some((unit) => unit.status === "In Use")) return "In Use";
  if (units.length > 0 && units.every((unit) => unit.status === "Offline")) return "Offline";
  return toToolStatus(undefined, tool.training_required);
}

function toToolStatus(status: string | undefined, trainingRequired: boolean): ToolStatus {
  if (status === "In Use") return "In Use";
  if (status === "Under Maintenance" || status === "Out of Service" || status === "Retired") {
    return "Offline";
  }
  if (trainingRequired) return "Training Required";
  return "Available";
}

function toCondition(
  condition: string | undefined,
  status: string | undefined
): MakerLabUnit["condition"] {
  if (status === "Out of Service" || status === "Retired") return "Offline";
  if (condition === "Needs Repair" || status === "Under Maintenance") return "Service Soon";
  if (condition === "Excellent" || condition === "Good") return condition;
  return "Good";
}

function deriveTrainingLevel(tool: ToolWithMeta): MakerLabTool["trainingLevel"] {
  const restrictionText = `${tool.use_restrictions || ""} ${tool.tags.join(" ")}`.toLowerCase();
  if (restrictionText.includes("advanced") || restrictionText.includes("authorized")) return "Advanced";
  if (tool.training_required) return "Intermediate";
  return "Beginner";
}

function deriveTrainingLabel(tool: ToolWithMeta): string {
  if (!tool.training_required) return "Beginner orientation";
  if (tool.use_restrictions) return tool.use_restrictions;
  return `${deriveTrainingLevel(tool)} checkout required`;
}

function localToolImage(name: string): string {
  return `/tool-images/${encodeURIComponent(name.replace(/\//g, "_"))}.png`;
}
