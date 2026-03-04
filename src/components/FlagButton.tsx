"use client";

import { useState } from "react";

interface FlagButtonProps {
  toolId: string;
  field: string;
  label?: string;
}

const FIELD_LABELS: Record<string, string> = {
  description: "Description",
  image: "Image",
  name: "Name",
  category: "Category",
  location: "Location",
  materials: "Materials",
  safety_info: "Safety Info",
};

export default function FlagButton({ toolId, field, label }: FlagButtonProps) {
  const [open, setOpen] = useState(false);
  const [issueDescription, setIssueDescription] = useState("");
  const [suggestedFix, setSuggestedFix] = useState("");
  const [reporter, setReporter] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setResult(null);

    try {
      const res = await fetch("/api/flag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tool_id: toolId,
          field_flagged: field,
          issue_description: issueDescription,
          suggested_fix: suggestedFix || undefined,
          reporter: reporter || undefined,
        }),
      });
      const data = await res.json();
      setResult(data);
      if (data.success) {
        setIssueDescription("");
        setSuggestedFix("");
      }
    } catch {
      setResult({ success: false, error: "Network error" });
    } finally {
      setSubmitting(false);
    }
  };

  if (result?.success) {
    return (
      <span className="text-xs text-accent-amber">
        Thanks — we&apos;ll review this.
      </span>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 text-xs text-muted hover:text-accent-amber transition-colors opacity-0 group-hover:opacity-100 focus:opacity-100"
        aria-label={`Flag ${label || FIELD_LABELS[field] || field} as incorrect`}
        title="Report incorrect information"
      >
        <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
            d="M3 21v-4m0 0V5a2 2 0 012-2h6.5l1 1H21l-3 6 3 6h-8.5l-1-1H5a2 2 0 00-2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-2 rounded-lg border border-accent-amber/20 bg-accent-amber/5 p-3 space-y-2"
    >
      <p className="text-xs font-medium text-accent-amber">
        Flag {FIELD_LABELS[field] || field} as incorrect
      </p>
      <textarea
        required
        value={issueDescription}
        onChange={(e) => setIssueDescription(e.target.value)}
        placeholder="What's wrong?"
        rows={2}
        className="w-full rounded border border-card-border bg-card-bg px-2 py-1.5 text-xs placeholder:text-muted focus:border-accent-amber focus:outline-none focus:ring-1 focus:ring-accent-amber resize-none"
      />
      <textarea
        value={suggestedFix}
        onChange={(e) => setSuggestedFix(e.target.value)}
        placeholder="What should it say instead? (optional)"
        rows={2}
        className="w-full rounded border border-card-border bg-card-bg px-2 py-1.5 text-xs placeholder:text-muted focus:border-accent-amber focus:outline-none focus:ring-1 focus:ring-accent-amber resize-none"
      />
      <input
        type="text"
        value={reporter}
        onChange={(e) => setReporter(e.target.value)}
        placeholder="Your name or NetID (optional)"
        className="w-full rounded border border-card-border bg-card-bg px-2 py-1.5 text-xs placeholder:text-muted focus:border-accent-amber focus:outline-none focus:ring-1 focus:ring-accent-amber"
      />
      {result?.error && (
        <p className="text-xs text-danger">{result.error}</p>
      )}
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={submitting || !issueDescription.trim()}
          className="rounded bg-accent-amber px-3 py-1 text-xs font-medium text-white disabled:opacity-50"
        >
          {submitting ? "Sending..." : "Submit"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded px-3 py-1 text-xs text-muted hover:text-foreground"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
