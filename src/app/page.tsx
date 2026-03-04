import {
  fetchAllTools,
  fetchAllCategories,
  fetchAllLocations,
  resolveTools,
} from "@/lib/airtable";
import { Suspense } from "react";
import HomeClient from "@/components/HomeClient";
import { siteConfig } from "@/lib/site-config";

export const revalidate = 3600; // ISR: 1 hour — tool data rarely changes

export default async function HomePage() {
  let resolved: import("@/lib/types").ToolWithMeta[] = [];
  let error: string | null = null;

  try {
    const [tools, categories, locations] = await Promise.all([
      fetchAllTools(),
      fetchAllCategories(),
      fetchAllLocations(),
    ]);
    resolved = resolveTools(tools, categories, locations);
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load tools";
  }

  // Extract unique filter options from the data
  const categoryGroups = [...new Set(resolved.map((t) => t.category_group))].sort();
  const rooms = [...new Set(resolved.map((t) => t.location_room))].sort();
  const allMaterials = [...new Set(resolved.flatMap((t) => t.materials))].sort();

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold">Tools</h1>
        <p className="mt-1 text-muted">
          Browse {resolved.length} tools and equipment in the {siteConfig.institution} {siteConfig.name.replace("Tools", "").trim()}.
        </p>
      </div>
      {error ? (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-6 text-center">
          <p className="text-danger font-medium">Unable to load tools</p>
          <p className="mt-1 text-sm text-muted">
            The data source is temporarily unavailable. Please try again in a few minutes.
          </p>
        </div>
      ) : (
        <Suspense fallback={<div className="py-8 text-center text-muted text-sm">Loading...</div>}>
          <HomeClient
            tools={resolved}
            categoryGroups={categoryGroups}
            rooms={rooms}
            materials={allMaterials}
          />
        </Suspense>
      )}
    </div>
  );
}
