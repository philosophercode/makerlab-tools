import {
  fetchAllCategories,
  fetchAllLocations,
  fetchAllResources,
  fetchAllTools,
  fetchAllUnits,
  getNotionEnvContract,
} from "../src/lib/notion";

function missingEnv(keys: string[]): string[] {
  return keys.filter((key) => !process.env[key]);
}

async function main(): Promise<void> {
  const missing = missingEnv(getNotionEnvContract());
  if (missing.length > 0) {
    console.log("Notion migration validation stub");
    console.log(`Missing env vars: ${missing.join(", ")}`);
    console.log(
      "Set the Notion env contract plus Airtable export inputs, then extend this script to compare v4 export counts and relations."
    );
    return;
  }

  const [tools, categories, locations, units, resources] = await Promise.all([
    fetchAllTools(),
    fetchAllCategories(),
    fetchAllLocations(),
    fetchAllUnits(),
    fetchAllResources(),
  ]);

  const categoryIds = new Set(categories.map((category) => category.id));
  const locationIds = new Set(locations.map((location) => location.id));
  const toolIds = new Set(tools.map((tool) => tool.id));

  const toolsMissingRequiredFields = tools.filter(
    (tool) => !tool.fields.name || !tool.fields.description
  );
  const toolsWithBrokenCategoryRelations = tools.filter((tool) =>
    (tool.fields.category || []).some((id) => !categoryIds.has(id))
  );
  const toolsWithBrokenLocationRelations = tools.filter((tool) =>
    (tool.fields.location || []).some((id) => !locationIds.has(id))
  );
  const unitsWithBrokenToolRelations = units.filter((unit) =>
    (unit.fields.tool || []).some((id) => !toolIds.has(id))
  );
  const resourcesWithBrokenToolRelations = resources.filter((resource) =>
    (resource.fields.tool || []).some((id) => !toolIds.has(id))
  );
  console.log("Notion migration validation");
  console.log(`Tools: ${tools.length}`);
  console.log(`Categories: ${categories.length}`);
  console.log(`Locations: ${locations.length}`);
  console.log(`Units: ${units.length}`);
  console.log(`Resources: ${resources.length}`);
  console.log(`Tools missing required fields: ${toolsMissingRequiredFields.length}`);
  console.log(
    `Tools with broken category relations: ${toolsWithBrokenCategoryRelations.length}`
  );
  console.log(
    `Tools with broken location relations: ${toolsWithBrokenLocationRelations.length}`
  );
  console.log(`Units with broken tool relations: ${unitsWithBrokenToolRelations.length}`);
  console.log(
    `Resources with broken tool relations: ${resourcesWithBrokenToolRelations.length}`
  );
  console.log(
    "TODO: compare these checks against the v4 Airtable export and verify deprecated fields were migrated intentionally."
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
