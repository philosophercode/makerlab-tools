"use client";

import { useState, useRef, useMemo, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import type { MaintenanceType, MaintenancePriority } from "@/lib/types";

interface ToolOption {
  id: string;
  name: string;
}

interface UnitOption {
  id: string;
  label: string;
  toolId: string;
  serialNumber?: string;
}

interface MaintenanceFormProps {
  tools: ToolOption[];
  units: UnitOption[];
}

interface PhotoFile {
  file: File;
  preview: string;
}

const MAX_PHOTOS = 5;
const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

const TYPES: MaintenanceType[] = [
  "Issue Report",
  "Preventive Maintenance",
  "Repair",
  "Inspection",
  "Calibration",
];

const PRIORITIES: MaintenancePriority[] = ["Critical", "High", "Medium", "Low"];

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Reads ?unit= from the URL and calls onPrefill with the value.
 * Isolated in its own component so useSearchParams() doesn't trigger
 * a page-level dynamic bailout / Suspense insertion by Next.js.
 */
function SearchParamsPrefill({ onPrefill }: { onPrefill: (unit: string) => void }) {
  const searchParams = useSearchParams();
  const unit = searchParams.get("unit") || "";
  useEffect(() => {
    onPrefill(unit);
  }, [unit, onPrefill]);
  return null;
}

export default function MaintenanceForm({ tools, units }: MaintenanceFormProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Step 1: Tool selection
  const [toolSearch, setToolSearch] = useState("");
  const [selectedToolId, setSelectedToolId] = useState("");

  // Step 2: Unit selection (filtered by tool)
  const [unitId, setUnitId] = useState("");

  // Prefill from ?unit= param (e.g. from QR code or unit page link)
  const [prefilledUnit, setPrefilledUnit] = useState("");
  useEffect(() => {
    if (!prefilledUnit) return;
    const unit = units.find((u) => u.id === prefilledUnit);
    if (!unit) return;
    const tool = tools.find((t) => t.id === unit.toolId);
    if (tool) {
      setSelectedToolId(tool.id);
      setToolSearch(tool.name);
    }
    setUnitId(unit.id);
  }, [prefilledUnit, units, tools]);

  // Form fields
  const [type, setType] = useState<MaintenanceType>("Issue Report");
  const [priority, setPriority] = useState<MaintenancePriority>("Medium");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [reportedBy, setReportedBy] = useState("");
  const [photos, setPhotos] = useState<PhotoFile[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{
    success: boolean;
    id?: string;
    error?: string;
  } | null>(null);

  // Filter tools by search
  const filteredTools = useMemo(() => {
    if (!toolSearch) return [];
    const q = toolSearch.toLowerCase();
    return tools.filter((t) => t.name.toLowerCase().includes(q)).slice(0, 10);
  }, [tools, toolSearch]);

  // Units for the selected tool
  const toolUnits = useMemo(() => {
    if (!selectedToolId) return [];
    return units.filter((u) => u.toolId === selectedToolId);
  }, [units, selectedToolId]);

  // Auto-select unit if tool has exactly one
  const handleSelectTool = (tool: ToolOption) => {
    setSelectedToolId(tool.id);
    setToolSearch(tool.name);
    setUnitId(""); // reset unit selection

    const matchingUnits = units.filter((u) => u.toolId === tool.id);
    if (matchingUnits.length === 1) {
      setUnitId(matchingUnits[0].id);
    }
  };

  const handleClearTool = () => {
    setSelectedToolId("");
    setToolSearch("");
    setUnitId("");
  };

  const handleAddPhotos = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    const remaining = MAX_PHOTOS - photos.length;
    const toAdd = files.slice(0, remaining);

    const valid = toAdd.filter((f) => {
      if (!f.type.startsWith("image/")) return false;
      if (f.size > MAX_FILE_SIZE) return false;
      return true;
    });

    const newPhotos = valid.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));

    setPhotos((prev) => [...prev, ...newPhotos]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removePhoto = (index: number) => {
    setPhotos((prev) => {
      URL.revokeObjectURL(prev[index].preview);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const photoData = await Promise.all(
        photos.map(async (p) => ({
          contentType: p.file.type,
          filename: p.file.name,
          base64: await fileToBase64(p.file),
        }))
      );

      const res = await fetch("/api/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          unit_id: unitId || undefined,
          type,
          priority,
          title,
          description,
          reported_by: reportedBy,
          photos: photoData.length > 0 ? photoData : undefined,
        }),
      });

      const data = await res.json();
      setResult(data);

      if (data.success) {
        setTitle("");
        setDescription("");
        photos.forEach((p) => URL.revokeObjectURL(p.preview));
        setPhotos([]);
      }
    } catch {
      setResult({ success: false, error: "Network error. Please try again." });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.success) {
    return (
      <div className="rounded-xl border border-success/20 bg-success/5 p-8 text-center" role="status" tabIndex={-1} ref={(el) => el?.focus()}>
        <div className="text-4xl mb-3">✓</div>
        <h2 className="text-lg font-semibold">Report Submitted</h2>
        <p className="mt-1 text-sm text-muted">
          Your issue has been logged. Ticket ID:{" "}
          <code className="rounded bg-muted-bg px-1.5 py-0.5 text-xs font-mono">
            {result.id}
          </code>
        </p>
        <button
          onClick={() => setResult(null)}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-dark transition-colors"
        >
          Submit Another Report
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <Suspense>
        <SearchParamsPrefill onPrefill={setPrefilledUnit} />
      </Suspense>
      {/* Step 1: Tool selector */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Which tool or equipment?
        </label>
        <input
          type="text"
          placeholder="Search by name (e.g. Prusa, laser cutter, Dremel)..."
          value={toolSearch}
          onChange={(e) => {
            setToolSearch(e.target.value);
            if (selectedToolId) {
              // User is editing after selection — clear
              setSelectedToolId("");
              setUnitId("");
            }
          }}
          className="w-full rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
        {toolSearch && !selectedToolId && filteredTools.length > 0 && (
          <div className="mt-1 max-h-48 overflow-y-auto rounded-lg border border-card-border bg-card-bg">
            {filteredTools.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTool(t)}
                aria-label={`Select ${t.name}`}
                className="block w-full px-3 py-2.5 text-left text-sm hover:bg-muted-bg"
              >
                {t.name}
              </button>
            ))}
          </div>
        )}
        {selectedToolId && (
          <button
            type="button"
            onClick={handleClearTool}
            className="mt-1 text-xs text-muted hover:text-foreground"
          >
            Change tool
          </button>
        )}
      </div>

      {/* Step 2: Unit selector (shown after tool is selected, if multiple units) */}
      {selectedToolId && toolUnits.length > 1 && (
        <div>
          <label className="mb-1.5 block text-sm font-medium">
            Which specific unit?{" "}
            <span className="text-muted">(optional — skip if unsure)</span>
          </label>
          <div className="space-y-1 rounded-lg border border-card-border bg-card-bg p-2">
            {toolUnits.map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setUnitId(unitId === u.id ? "" : u.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors ${
                  unitId === u.id
                    ? "bg-primary/5 text-primary border border-primary/20"
                    : "hover:bg-muted-bg"
                }`}
              >
                <span className="font-medium">{u.label}</span>
                {u.serialNumber && (
                  <span className="ml-2 text-xs text-muted font-mono">
                    {u.serialNumber}
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Single unit auto-selected confirmation */}
      {selectedToolId && toolUnits.length === 1 && (
        <p className="text-xs text-muted">
          Unit auto-selected: <span className="font-medium">{toolUnits[0].label}</span>
          {toolUnits[0].serialNumber && (
            <span className="ml-1 font-mono">({toolUnits[0].serialNumber})</span>
          )}
        </p>
      )}

      {/* Type */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Type</label>
        <select
          value={type}
          onChange={(e) => setType(e.target.value as MaintenanceType)}
          className="w-full rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </div>

      {/* Priority */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">Priority</label>
        <div className="flex gap-2">
          {PRIORITIES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setPriority(p)}
              className={`rounded-full px-3 py-1 text-xs transition-colors ${
                priority === p
                  ? "bg-primary text-white"
                  : "bg-muted-bg text-muted hover:bg-card-border"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Title */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          What&apos;s wrong? <span className="text-danger">*</span>
        </label>
        <input
          type="text"
          required
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Brief summary of the issue"
          className="w-full rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Details <span className="text-muted">(optional)</span>
        </label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What happened? What were you trying to do?"
          rows={3}
          className="w-full rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
        />
      </div>

      {/* Photos */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Photos <span className="text-muted">(optional, max {MAX_PHOTOS})</span>
        </label>

        {photos.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-2">
            {photos.map((p, i) => (
              <div key={i} className="relative h-20 w-20">
                <img
                  src={p.preview}
                  alt={`Photo ${i + 1}`}
                  className="h-full w-full rounded-lg border border-card-border object-cover"
                />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white text-xs"
                  aria-label={`Remove photo ${i + 1}`}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}

        {photos.length < MAX_PHOTOS && (
          <>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleAddPhotos}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-2 rounded-lg border border-dashed border-card-border px-4 py-3 text-sm text-muted hover:bg-muted-bg transition-colors w-full justify-center"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Add photos
            </button>
            <p className="mt-1 text-xs text-muted">
              Max 5MB per image. JPG, PNG, or HEIC.
            </p>
          </>
        )}
      </div>

      {/* Reported by */}
      <div>
        <label className="mb-1.5 block text-sm font-medium">
          Your Name or NetID
        </label>
        <input
          type="text"
          value={reportedBy}
          onChange={(e) => setReportedBy(e.target.value)}
          placeholder="e.g., Jane Smith or js1234"
          className="w-full rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Error */}
      {result?.error && (
        <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
          {result.error}
        </div>
      )}

      {/* Submit */}
      <button
        type="submit"
        disabled={submitting || !title.trim()}
        className="w-full rounded-lg bg-primary px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:opacity-50"
      >
        {submitting
          ? photos.length > 0
            ? "Uploading photos..."
            : "Submitting..."
          : "Submit Report"}
      </button>
    </form>
  );
}
