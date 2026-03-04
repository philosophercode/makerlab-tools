"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
import type { ToolWithMeta } from "@/lib/types";
import {
  setProcessing,
  clearProcessing,
  getProcessing,
} from "@/lib/image-processing";

type ActionStatus = null | "generating" | "removing-bg" | "done" | "error";

const STATUS_MESSAGES: Record<string, { label: string; sub: string }> = {
  generating: {
    label: "Generating image",
    sub: "Gemini 3 Pro + chromakey green screen...",
  },
  "removing-bg": {
    label: "Removing background",
    sub: "Running U2-Net locally...",
  },
  done: {
    label: "Done!",
    sub: "Image updated successfully",
  },
  error: {
    label: "Failed",
    sub: "Something went wrong — try again",
  },
};

export default function ToolCard({
  tool,
  compact = false,
  priority = false,
  showGenerated = true,
}: {
  tool: ToolWithMeta;
  compact?: boolean;
  priority?: boolean;
  showGenerated?: boolean;
}) {
  const hasPPE = tool.ppe_required.length > 0;
  const needsAuth = tool.authorized_only;
  const needsTraining = tool.training_required;
  const [status, setStatus] = useState<ActionStatus>(null);
  const [imgSrc, setImgSrc] = useState(
    (showGenerated && tool.generated_image_url) || tool.image_url
  );
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Sync image when showGenerated toggle changes
  useEffect(() => {
    if (!status) {
      setImgSrc((showGenerated && tool.generated_image_url) || tool.image_url);
    }
  }, [showGenerated, tool.generated_image_url, tool.image_url, status]);

  const isProcessing = status === "generating" || status === "removing-bg";

  // Elapsed time counter
  useEffect(() => {
    if (isProcessing) {
      const entry = getProcessing(tool.name);
      const startedAt = entry?.startedAt || Date.now();
      setElapsed(Math.floor((Date.now() - startedAt) / 1000));
      timerRef.current = setInterval(
        () => setElapsed(Math.floor((Date.now() - startedAt) / 1000)),
        1000
      );
    } else {
      if (timerRef.current) clearInterval(timerRef.current);
    }
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isProcessing, tool.name]);

  // Handle completion: update image and clear state
  const handleDone = useCallback(() => {
    clearProcessing(tool.name);
    setStatus("done");
    const safeName = tool.name.replace(/\//g, "_");
    setImgSrc(
      `/tool-images/${encodeURIComponent(safeName)}.png?v=${Date.now()}`
    );
    setTimeout(() => setStatus(null), 2000);
  }, [tool.name]);

  // Poll for completion when processing
  useEffect(() => {
    if (!isProcessing) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const entry = getProcessing(tool.name);
    if (!entry) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/image?toolName=${encodeURIComponent(tool.name)}&since=${entry.startedAt}`
        );
        const data = await res.json();
        if (data.done) {
          if (pollRef.current) clearInterval(pollRef.current);
          handleDone();
        }
      } catch {}
    }, 2000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [isProcessing, tool.name, handleDone]);

  // On mount: restore processing state from localStorage
  useEffect(() => {
    const entry = getProcessing(tool.name);
    if (entry) {
      setStatus(
        entry.action === "regenerate" ? "generating" : "removing-bg"
      );
    }
  }, [tool.name]);

  const handleImageAction = (
    e: React.MouseEvent,
    action: "regenerate" | "remove-bg"
  ) => {
    e.preventDefault();
    e.stopPropagation();

    const newStatus =
      action === "regenerate" ? "generating" : "removing-bg";
    setStatus(newStatus);
    setProcessing(tool.name, action);

    // Fire and forget — the server spawns a detached process.
    // Polling via GET /api/image detects when the image file is updated.
    fetch("/api/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ toolName: tool.name, action }),
    }).catch(() => {
      // Connection may drop on navigation — that's fine,
      // the background process keeps running.
    });
  };

  return (
    <a
      href={`/tools/${tool.id}`}
      className={`group block rounded-xl border bg-card-bg overflow-hidden transition-shadow hover:shadow-lg ${
        isProcessing
          ? "border-primary/50 ring-1 ring-primary/20"
          : "border-card-border"
      }`}
    >
      {/* Image */}
      <div
        className={`relative bg-muted-bg ${
          compact ? "aspect-[4/3]" : "aspect-square"
        }`}
      >
        {imgSrc ? (
          <Image
            src={imgSrc}
            alt={tool.name}
            fill
            className={`object-contain transition-all ${
              compact ? "p-2" : "p-4"
            } ${
              isProcessing
                ? "opacity-30 blur-sm scale-95"
                : "group-hover:scale-105"
            }`}
            sizes={
              compact
                ? "(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 18vw"
                : "(max-width: 640px) 92vw, (max-width: 1024px) 45vw, 23vw"
            }
            priority={priority}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-muted text-sm">
            No image
          </div>
        )}

        {/* Processing overlay — hidden in compact mode */}
        {status && !compact && (
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            {isProcessing && (
              <>
                <div className="relative mb-3">
                  <div
                    className="absolute inset-0 rounded-full border-2 border-primary/30 animate-ping"
                    style={{ width: 48, height: 48 }}
                  />
                  <div className="w-12 h-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                </div>
                <p className="text-sm font-semibold text-foreground">
                  {STATUS_MESSAGES[status]?.label}
                </p>
                <p className="text-xs text-muted mt-0.5 px-4 text-center">
                  {STATUS_MESSAGES[status]?.sub}
                </p>
                <p className="text-xs text-muted/60 mt-2 tabular-nums">
                  {elapsed}s
                </p>
              </>
            )}

            {status === "done" && (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-accent-green/10 border-2 border-accent-green flex items-center justify-center mb-2">
                  <CheckIcon />
                </div>
                <p className="text-sm font-semibold text-accent-green">
                  {STATUS_MESSAGES.done.label}
                </p>
              </div>
            )}

            {status === "error" && (
              <div className="flex flex-col items-center">
                <div className="w-12 h-12 rounded-full bg-danger/10 border-2 border-danger flex items-center justify-center mb-2">
                  <XIcon />
                </div>
                <p className="text-sm font-semibold text-danger">
                  {STATUS_MESSAGES.error.label}
                </p>
                <p className="text-xs text-muted mt-0.5">
                  {STATUS_MESSAGES.error.sub}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Image action buttons — visible on hover, hidden in compact mode and during processing */}
        {!status && !compact && (
          <div className="absolute bottom-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              type="button"
              onClick={(e) => handleImageAction(e, "regenerate")}
              className="rounded-md bg-card-bg/90 border border-card-border p-1.5 text-muted hover:text-primary hover:border-primary transition-colors backdrop-blur-sm"
              title="Regenerate image (Gemini)"
            >
              <SparklesIcon />
            </button>
            <button
              type="button"
              onClick={(e) => handleImageAction(e, "remove-bg")}
              className="rounded-md bg-card-bg/90 border border-card-border p-1.5 text-muted hover:text-primary hover:border-primary transition-colors backdrop-blur-sm"
              title="Re-run background removal"
            >
              <EraserIcon />
            </button>
          </div>
        )}
      </div>

      {/* Info */}
      <div className={compact ? "p-2.5" : "p-4"}>
        <h2
          className={`font-semibold leading-tight line-clamp-2 group-hover:text-primary transition-colors ${
            compact ? "text-xs" : "text-sm"
          }`}
        >
          {tool.name}
        </h2>
        {!compact && (
          <p className="mt-1 text-xs text-muted line-clamp-2">
            {tool.description}
          </p>
        )}

        {/* Category + Location */}
        <div className={`flex flex-wrap gap-1 ${compact ? "mt-1" : "mt-2 gap-1.5"}`}>
          <span className="inline-block rounded-full bg-muted-bg px-2 py-0.5 text-[11px] text-muted">
            {tool.category_group}
          </span>
          {!compact && (
            <span className="inline-block rounded-full bg-muted-bg px-2 py-0.5 text-[11px] text-muted">
              {tool.location_room}
            </span>
          )}
        </div>

        {/* Safety badges */}
        {!compact && (hasPPE || needsAuth || needsTraining) && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {hasPPE && (
              <span className="inline-block rounded-full bg-warning/10 px-2 py-0.5 text-[11px] text-warning font-medium">
                PPE Required
              </span>
            )}
            {needsTraining && (
              <span className="inline-block rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary font-medium">
                Training
              </span>
            )}
            {needsAuth && (
              <span className="inline-block rounded-full bg-danger/10 px-2 py-0.5 text-[11px] text-danger font-medium">
                Auth Only
              </span>
            )}
          </div>
        )}
      </div>
    </a>
  );
}

function CheckIcon() {
  return (
    <svg
      className="h-6 w-6 text-accent-green"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M5 13l4 4L19 7"
      />
    </svg>
  );
}

function XIcon() {
  return (
    <svg
      className="h-6 w-6 text-danger"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2.5}
        d="M6 18L18 6M6 6l12 12"
      />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z"
      />
    </svg>
  );
}

function EraserIcon() {
  return (
    <svg
      className="h-4 w-4"
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 21H6.75a2.25 2.25 0 01-2.25-2.25V6A2.25 2.25 0 016.75 3.75h10.5A2.25 2.25 0 0119.5 6v1.5"
      />
    </svg>
  );
}
