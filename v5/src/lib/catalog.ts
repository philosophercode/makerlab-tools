import {
  fetchAllCategories,
  fetchAllLocations,
  fetchCatalogTools,
  fetchResourcesByTool,
  fetchTool,
  fetchUnitsByTool,
  getNotionEnvContract,
  resolveTools,
} from "./notion";
import type { ResourceRecord, ToolWithMeta, UnitRecord } from "./types";
import type { CatalogStats, MakerLabTool, MakerLabUnit, ToolStatus } from "../components/catalog-types";
import { catalogStats as mockStats, getToolBySlug, mockTools } from "../components/mock-catalog";

export function hasNotionCatalogEnv(): boolean {
  return getNotionEnvContract().every((key) => Boolean(process.env[key]));
}

export async function getCatalogTools(): Promise<MakerLabTool[]> {
  if (!hasNotionCatalogEnv()) return mockTools;

  try {
    const tools = await fetchCatalogTools();
    const units = await Promise.all(
      tools.map(async (tool) => [tool.id, await fetchUnitsByTool(tool.id)] as const)
    );
    const unitsByTool = new Map(units);

    return tools.map((tool) => toMakerLabTool(tool, unitsByTool.get(tool.id) || []));
  } catch (error) {
    console.warn("Falling back to mock catalog:", error);
    return mockTools;
  }
}

export async function getCatalogStats(): Promise<CatalogStats> {
  const tools = await getCatalogTools();

  if (tools === mockTools) return mockStats;

  return {
    toolsOnline: tools.filter((tool) => tool.status !== "Offline").length,
    awaitingTraining: tools.filter((tool) => tool.trainingLevel !== "Beginner").length,
    labHours: "LAB OPEN 9AM-9PM",
  };
}

export async function getCatalogTool(id: string): Promise<MakerLabTool | null> {
  if (!hasNotionCatalogEnv()) {
    return getToolBySlug(id) || null;
  }

  try {
    const [tool, categories, locations, units, resources] = await Promise.all([
      fetchTool(id),
      fetchAllCategories(),
      fetchAllLocations(),
      fetchUnitsByTool(id),
      fetchResourcesByTool(id),
    ]);
    const [resolved] = resolveTools([tool], categories, locations);
    return resolved ? toMakerLabTool(resolved, units, resources) : null;
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
  const materials = tool.materials.length ? tool.materials.join(", ") : "Contact MakerLab staff";
  const location = [tool.location_room, tool.location_zone].filter(Boolean).join(" // ");

  return {
    id: tool.id,
    slug: tool.id,
    name: tool.name,
    category: tool.category_group,
    location: tool.location_room,
    zone: tool.location_zone,
    trainingLevel: deriveTrainingLevel(tool),
    status,
    shortDescription: tool.description || "Catalog record pending description.",
    description: tool.description || "This tool record is available in the MakerLab catalog.",
    imageSrc: tool.image_url || localToolImage(tool.name),
    ppe: tool.ppe_required.length ? tool.ppe_required : ["Check posted lab guidance"],
    specs: [
      { label: "Category", value: `${tool.category_group} // ${tool.category_sub}` },
      { label: "Location", value: location || "Unknown" },
      { label: "Materials", value: materials },
      { label: "Training", value: deriveTrainingLabel(tool) },
      ...(tool.map_tag ? [{ label: "Map ID", value: tool.map_tag }] : []),
      ...(tool.emergency_stop ? [{ label: "Emergency Stop", value: tool.emergency_stop }] : []),
      ...(tool.use_restrictions ? [{ label: "Restrictions", value: tool.use_restrictions }] : []),
    ],
    links: resourceLinks(resources, tool),
    units: mappedUnits,
  };
}

function resourceLinks(resources: ResourceRecord[], tool: ToolWithMeta): MakerLabTool["links"] {
  const links = resources.flatMap((resource) => {
    const fields = resource.fields;
    const base = {
      kind: fields.type || "Resource",
      description: fields.content || fields.notes || undefined,
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

  if (links.length > 0) return links;

  return [
    ...(tool.sop_url ? [{ label: "SOP", href: tool.sop_url, kind: "SOP" }] : []),
    ...(tool.safety_doc_url
      ? [{ label: "Safety Doc", href: tool.safety_doc_url, kind: "Safety" }]
      : []),
    ...(tool.video_url ? [{ label: "Video", href: tool.video_url, kind: "Video" }] : []),
    ...tool.manual_attachments.map((manual, index) => ({
      label: manual.filename || `Manual ${index + 1}`,
      href: manual.url,
      kind: "Manual",
    })),
  ];
}

function toMakerLabUnit(unit: UnitRecord, tool: ToolWithMeta): MakerLabUnit {
  return {
    id: unit.id,
    name: unit.fields.unit_label || `${tool.name} // Unit`,
    serial: unit.fields.serial_number || unit.fields.asset_tag || unit.fields.uuid || "Unlisted",
    status: toToolStatus(unit.fields.status, false),
    condition: toCondition(unit.fields.condition, unit.fields.status),
    location: tool.location_zone || tool.location_room || "Unknown",
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
