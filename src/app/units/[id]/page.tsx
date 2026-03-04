import { notFound } from "next/navigation";
import {
  fetchUnit,
  fetchTool,
  fetchAllCategories,
  fetchAllLocations,
  fetchMaintenanceLogsByUnit,
  resolveTools,
} from "@/lib/airtable";
import ImageGallery from "@/components/ImageGallery";
import type { Attachment } from "@/lib/types";

export const revalidate = 60; // 1 minute — status changes often

const STATUS_COLORS: Record<string, string> = {
  Available: "bg-success/10 text-success",
  "In Use": "bg-warning/10 text-warning",
  "Under Maintenance": "bg-primary/10 text-primary",
  "Out of Service": "bg-danger/10 text-danger",
  Retired: "bg-muted-bg text-muted",
};

const CONDITION_COLORS: Record<string, string> = {
  Excellent: "text-success",
  Good: "text-foreground",
  Fair: "text-warning",
  "Needs Repair": "text-danger",
};

export default async function UnitDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  let unit;
  try {
    unit = await fetchUnit(id);
  } catch {
    notFound();
  }

  if (!unit) notFound();

  const fields = unit.fields;

  // Resolve parent tool
  let parentTool: {
    id: string;
    name: string;
    imageUrl: string | null;
    generatedImageUrl: string | null;
    imageAttachments: Attachment[];
  } | null = null;
  if (fields.tool?.[0]) {
    try {
      const [toolRecord, categories, locations] = await Promise.all([
        fetchTool(fields.tool[0]),
        fetchAllCategories(),
        fetchAllLocations(),
      ]);
      const resolved = resolveTools([toolRecord], categories, locations)[0];
      parentTool = {
        id: resolved.id,
        name: resolved.name,
        imageUrl: resolved.image_url,
        generatedImageUrl: resolved.generated_image_url,
        imageAttachments: resolved.image_attachments,
      };
    } catch {
      // Continue without parent tool info
    }
  }

  // Fetch recent maintenance logs
  let logs: Awaited<ReturnType<typeof fetchMaintenanceLogsByUnit>> = [];
  try {
    logs = await fetchMaintenanceLogsByUnit(id);
  } catch {
    // Continue without logs
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      {/* Breadcrumb */}
      <nav className="sticky top-14 z-40 -mx-4 mb-6 border-b border-card-border bg-background/90 px-4 py-2.5 text-sm text-muted backdrop-blur-sm">
        <a href="/" className="hover:text-foreground">
          Tools
        </a>
        {parentTool && (
          <>
            <span className="mx-2">/</span>
            <a
              href={`/tools/${parentTool.id}`}
              className="hover:text-foreground"
            >
              {parentTool.name}
            </a>
          </>
        )}
        <span className="mx-2">/</span>
        <span className="text-foreground font-medium">{fields.unit_label}</span>
      </nav>

      {/* Unit header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold">{fields.unit_label}</h1>
        {parentTool && (
          <a
            href={`/tools/${parentTool.id}`}
            className="mt-1 inline-block text-sm text-primary hover:underline"
          >
            {parentTool.name}
          </a>
        )}
        {parentTool && (
          <div className="mt-4 max-w-sm">
            <ImageGallery
              images={parentTool.imageAttachments}
              toolName={parentTool.name}
              generatedImageUrl={parentTool.generatedImageUrl || undefined}
            />
          </div>
        )}
      </div>

      {/* Status + Condition */}
      <div className="mb-6 grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-card-border p-4">
          <span className="block text-xs font-medium text-muted mb-1">Status</span>
          <span
            className={`inline-block rounded-full px-3 py-1 text-sm font-medium ${
              STATUS_COLORS[fields.status || ""] || "bg-muted-bg text-muted"
            }`}
          >
            {fields.status || "Unknown"}
          </span>
        </div>
        <div className="rounded-lg border border-card-border p-4">
          <span className="block text-xs font-medium text-muted mb-1">Condition</span>
          <span
            className={`text-sm font-medium ${
              CONDITION_COLORS[fields.condition || ""] || "text-muted"
            }`}
          >
            {fields.condition || "Unknown"}
          </span>
        </div>
      </div>

      {/* Details */}
      <div className="mb-6 space-y-3">
        {fields.serial_number && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">Serial Number</span>
            <span className="font-mono">{fields.serial_number}</span>
          </div>
        )}
        {fields.asset_tag && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">Asset Tag</span>
            <span className="font-mono">{fields.asset_tag}</span>
          </div>
        )}
        {fields.date_acquired && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">Acquired</span>
            <span>{new Date(fields.date_acquired).toLocaleDateString()}</span>
          </div>
        )}
        {fields.qr_code_id && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">QR Code ID</span>
            <span className="font-mono">{fields.qr_code_id}</span>
          </div>
        )}
      </div>

      {/* Notes */}
      {fields.notes && (
        <div className="mb-6 rounded-lg border border-card-border p-4">
          <span className="block text-xs font-medium text-muted mb-1">Notes</span>
          <p className="text-sm whitespace-pre-wrap">{fields.notes}</p>
        </div>
      )}

      {/* Report Issue button */}
      <div className="mb-8">
        <a
          href={`/report?unit=${id}`}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark"
        >
          Report an Issue
        </a>
      </div>

      {/* Recent maintenance logs */}
      {logs.length > 0 && (
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted">
            Recent Maintenance ({logs.length})
          </h2>
          <div className="space-y-2">
            {logs.map((log) => (
              <div
                key={log.id}
                className="rounded-lg border border-card-border p-3"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <p className="text-sm font-medium">
                      {log.fields.title}
                    </p>
                    {log.fields.description && (
                      <p className="mt-0.5 text-xs text-muted line-clamp-2">
                        {log.fields.description}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs">
                    {log.fields.priority && (
                      <span
                        className={`rounded-full px-2 py-0.5 font-medium ${
                          log.fields.priority === "Critical"
                            ? "bg-danger/10 text-danger"
                            : log.fields.priority === "High"
                              ? "bg-warning/10 text-warning"
                              : "bg-muted-bg text-muted"
                        }`}
                      >
                        {log.fields.priority}
                      </span>
                    )}
                    {log.fields.status && (
                      <span className="text-muted">{log.fields.status}</span>
                    )}
                  </div>
                </div>
                {log.fields.date_reported && (
                  <p className="mt-1 text-xs text-muted">
                    {new Date(log.fields.date_reported).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
