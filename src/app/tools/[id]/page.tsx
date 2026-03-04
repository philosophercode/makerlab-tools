import { notFound } from "next/navigation";
import {
  fetchTool,
  fetchAllCategories,
  fetchAllLocations,
  fetchUnitsByTool,
  resolveTools,
} from "@/lib/airtable";
import ImageGallery from "@/components/ImageGallery";
import SafetyBadges from "@/components/SafetyBadges";
import DocLinks from "@/components/DocLinks";
import UnitStatusTable from "@/components/UnitStatusTable";
import Chat from "@/components/Chat";
import FlagButton from "@/components/FlagButton";
import ImageActions from "@/components/ImageActions";
import MobileToolLayout from "@/components/MobileToolLayout";

export const revalidate = 3600; // ISR: 1 hour — tool data rarely changes

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let tool;
  let units: Awaited<ReturnType<typeof fetchUnitsByTool>> = [];
  try {
    const [toolRecord, categories, locations, fetchedUnits] = await Promise.all([
      fetchTool(id),
      fetchAllCategories(),
      fetchAllLocations(),
      fetchUnitsByTool(id).catch(() => [] as Awaited<ReturnType<typeof fetchUnitsByTool>>),
    ]);
    const resolved = resolveTools([toolRecord], categories, locations);
    tool = resolved[0];
    units = fetchedUnits;
  } catch {
    notFound();
  }

  if (!tool) notFound();

  const infoContent = (
    <>
      {/* Image */}
      <div className="group relative">
        <ImageGallery
          images={tool.image_attachments}
          toolName={tool.name}
          localImageUrl={tool.image_url || undefined}
          generatedImageUrl={tool.generated_image_url || undefined}
        />
        <div className="absolute top-2 right-2">
          <FlagButton toolId={id} field="image" />
        </div>
      </div>
      <ImageActions toolName={tool.name} />

      {/* Name + description */}
      <div className="group">
        <div className="flex items-start justify-between gap-2">
          <h1 className="text-2xl font-bold">{tool.name}</h1>
          <FlagButton toolId={id} field="name" />
        </div>
        <div className="flex items-start justify-between gap-2 mt-2">
          <p className="text-muted leading-relaxed">
            {tool.description}
          </p>
          <FlagButton toolId={id} field="description" />
        </div>
      </div>

      {/* Notes */}
      {tool.notes && (
        <div>
          <span className="block text-xs font-medium text-muted mb-1">
            Notes
          </span>
          <p className="text-sm text-muted leading-relaxed whitespace-pre-wrap">
            {tool.notes}
          </p>
        </div>
      )}

      {/* Safety */}
      <div className="group flex items-start justify-between gap-2">
        <SafetyBadges
          ppe_required={tool.ppe_required}
          training_required={tool.training_required}
          authorized_only={tool.authorized_only}
        />
        <FlagButton toolId={id} field="safety_info" />
      </div>

      {/* Metadata */}
      <div className="grid grid-cols-2 gap-4">
        <div className="group">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted">Category</span>
            <FlagButton toolId={id} field="category" />
          </div>
          <p className="mt-0.5 text-sm">
            {tool.category_group} — {tool.category_sub}
          </p>
        </div>
        <div className="group">
          <div className="flex items-center gap-1">
            <span className="text-xs font-medium text-muted">Location</span>
            <FlagButton toolId={id} field="location" />
          </div>
          <p className="mt-0.5 text-sm">
            {tool.location_room} — {tool.location_zone}
          </p>
        </div>
      </div>

      {/* Materials */}
      {tool.materials.length > 0 && (
        <div className="group">
          <div className="flex items-center gap-1 mb-1.5">
            <span className="text-xs font-medium text-muted">
              Compatible Materials
            </span>
            <FlagButton toolId={id} field="materials" />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {tool.materials.map((m) => (
              <span
                key={m}
                className="rounded-full bg-muted-bg px-2.5 py-0.5 text-xs"
              >
                {m}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Use restrictions */}
      {tool.use_restrictions && (
        <div>
          <span className="block text-xs font-medium text-muted mb-1">
            Use Restrictions
          </span>
          <p className="text-sm text-muted leading-relaxed">
            {tool.use_restrictions}
          </p>
        </div>
      )}

      {/* Emergency stop */}
      {tool.emergency_stop && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-3">
          <span className="block text-xs font-semibold text-danger mb-1">
            Emergency Stop
          </span>
          <p className="text-sm">{tool.emergency_stop}</p>
        </div>
      )}

      {/* Documentation links */}
      <DocLinks
        safety_doc_url={tool.safety_doc_url}
        sop_url={tool.sop_url}
        video_url={tool.video_url}
      />

      {/* Manual downloads */}
      {tool.manual_attachments.length > 0 && (
        <div>
          <span className="block text-sm font-medium text-muted mb-2">Manuals</span>
          <div className="space-y-1.5">
            {tool.manual_attachments.map((a) => (
              <a
                key={a.id}
                href={a.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg border border-card-border px-3 py-2 text-sm hover:bg-muted-bg transition-colors"
              >
                <span>📄</span>
                <span className="truncate">{a.filename}</span>
                <span className="ml-auto text-xs text-muted">
                  {(a.size / 1024).toFixed(0)} KB
                </span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Units table */}
      <UnitStatusTable units={units} />
    </>
  );

  const chatContent = (
    <Chat
      toolId={id}
      header={`Ask about ${tool.name}`}
      suggestions={(() => {
        const s: string[] = [`How do I use the ${tool.name}?`];
        if (tool.ppe_required.length > 0)
          s.push("What PPE do I need?");
        if (tool.training_required)
          s.push("How do I get trained on this?");
        else
          s.push("Any safety precautions?");
        if (tool.materials.length > 0)
          s.push(`What ${tool.materials.slice(0, 2).join(" and ")} settings should I use?`);
        else
          s.push("What can I make with this?");
        return s.slice(0, 3);
      })()}
    />
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pb-4 lg:py-8 flex flex-col lg:block max-lg:h-[calc(100dvh-3.5rem)] max-lg:overflow-hidden">
      {/* Breadcrumb */}
      <nav className="lg:sticky lg:top-14 z-40 -mx-4 mb-2 lg:mb-6 border-b border-card-border bg-background/90 px-4 py-2 lg:py-2.5 text-sm text-muted backdrop-blur-sm flex-shrink-0">
        <a href="/" className="hover:text-foreground">
          Tools
        </a>
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">{tool.name}</span>
      </nav>

      <MobileToolLayout infoContent={infoContent} chatContent={chatContent} />
    </div>
  );
}
