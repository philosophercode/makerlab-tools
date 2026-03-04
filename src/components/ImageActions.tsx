"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import {
  setProcessing,
  clearProcessing,
  getProcessing,
} from "@/lib/image-processing";

interface ImageActionsProps {
  toolName: string;
}

type ActionStatus = null | "generating" | "removing-bg" | "done" | "error";
type ActionType = "regenerate" | "remove-bg" | "replace-from-url";

interface SearchCandidate {
  title: string;
  imageUrl: string;
  pageUrl: string;
}

export default function ImageActions({ toolName }: ImageActionsProps) {
  const [status, setStatus] = useState<ActionStatus>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [searching, setSearching] = useState(false);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isProcessing = status === "generating" || status === "removing-bg";

  // Elapsed timer
  useEffect(() => {
    if (isProcessing) {
      const entry = getProcessing(toolName);
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
  }, [isProcessing, toolName]);

  const handleDone = useCallback(() => {
    clearProcessing(toolName);
    setStatus("done");
    setTimeout(() => window.location.reload(), 1500);
  }, [toolName]);

  // Poll for completion
  useEffect(() => {
    if (!isProcessing) {
      if (pollRef.current) clearInterval(pollRef.current);
      return;
    }

    const entry = getProcessing(toolName);
    if (!entry) return;

    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch(
          `/api/image?toolName=${encodeURIComponent(toolName)}&since=${entry.startedAt}`
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
  }, [isProcessing, toolName, handleDone]);

  // Restore state on mount
  useEffect(() => {
    const entry = getProcessing(toolName);
    if (entry) {
      setStatus(entry.action === "regenerate" ? "generating" : "removing-bg");
    }
  }, [toolName]);

  const handleAction = async (action: ActionType, sourceUrl?: string) => {
    const newStatus = action === "regenerate" ? "generating" : "removing-bg";
    setStatus(newStatus);
    setErrorMsg("");
    setProcessing(toolName, action);

    // Fire and forget — server spawns a detached background process.
    // Polling via GET /api/image detects when the image file is updated.
    try {
      const res = await fetch("/api/image", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toolName, action, sourceUrl }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error || "Request failed");
      }
    } catch (err) {
      clearProcessing(toolName);
      setStatus("error");
      setErrorMsg(err instanceof Error ? err.message : "Request failed");
    }
  };

  const handleSearch = async () => {
    setSearching(true);
    setErrorMsg("");
    try {
      const res = await fetch(`/api/image-search?q=${encodeURIComponent(toolName)}`);
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || "Search failed");
      }
      setCandidates(data.candidates || []);
      if (!data.candidates?.length) {
        setErrorMsg("No candidates found. Try regenerate instead.");
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => handleAction("regenerate")}
          disabled={isProcessing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          title="Generate a new image with Gemini AI"
        >
          <SparklesIcon />
          Regenerate
        </button>

        <button
          type="button"
          onClick={() => handleAction("remove-bg")}
          disabled={isProcessing}
          className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          title="Re-run background removal on the original image"
        >
          <EraserIcon />
          Clear BG
        </button>

        <button
          type="button"
          onClick={handleSearch}
          disabled={isProcessing || searching}
          className="inline-flex items-center gap-1.5 rounded-lg border border-card-border bg-card-bg px-3 py-1.5 text-xs font-medium text-muted hover:text-foreground hover:border-primary transition-colors disabled:opacity-50"
          title="Search online for replacement image candidates"
        >
          {searching ? "Searching..." : "Find Web Image"}
        </button>
      </div>

      {candidates.length > 0 && !isProcessing && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {candidates.map((c) => (
            <div key={c.imageUrl} className="rounded-lg border border-card-border p-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={c.imageUrl}
                alt={c.title}
                className="h-24 w-full rounded object-cover"
              />
              <p className="mt-1 line-clamp-2 text-[11px] text-muted">{c.title}</p>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAction("replace-from-url", c.imageUrl)}
                  className="rounded border border-card-border px-2 py-1 text-[11px] hover:border-primary"
                >
                  Use
                </button>
                <a
                  href={c.pageUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[11px] text-primary hover:underline"
                >
                  Source
                </a>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Status feedback bar */}
      {(status || errorMsg) && (
        <div
          className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
            isProcessing
              ? "border-primary/20 bg-primary/5"
              : status === "done"
              ? "border-accent-green/20 bg-accent-green/5"
              : "border-danger/20 bg-danger/5"
          }`}
        >
          {isProcessing && (
            <>
              <div className="w-5 h-5 rounded-full border-2 border-primary border-t-transparent animate-spin flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="font-medium text-foreground text-xs">
                  {status === "generating"
                    ? "Generating with Gemini 3 Pro on green screen..."
                    : "Removing background with U2-Net..."}
                </p>
                <p className="text-muted text-xs mt-0.5">
                  {status === "generating"
                    ? "Chromakey green backdrop, then color-keyed to transparent"
                    : "Processing the original image locally"}
                </p>
              </div>
              <span className="text-xs text-muted/60 tabular-nums flex-shrink-0">
                {elapsed}s
              </span>
            </>
          )}

          {status === "done" && (
            <>
              <div className="w-5 h-5 rounded-full bg-accent-green/10 border-2 border-accent-green flex items-center justify-center flex-shrink-0">
                <CheckIcon />
              </div>
              <p className="font-medium text-accent-green text-xs">
                Image updated — reloading...
              </p>
            </>
          )}

          {status === "error" && (
            <>
              <div className="w-5 h-5 rounded-full bg-danger/10 border-2 border-danger flex items-center justify-center flex-shrink-0">
                <XIcon />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-danger text-xs">Failed</p>
                {errorMsg && (
                  <p className="text-muted text-xs mt-0.5 truncate">
                    {errorMsg}
                  </p>
                )}
              </div>
            </>
          )}

          {!status && errorMsg && (
            <p className="text-xs text-danger">{errorMsg}</p>
          )}
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="h-3 w-3 text-accent-green" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-3 w-3 text-danger" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function SparklesIcon() {
  return (
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M18 21H6.75a2.25 2.25 0 01-2.25-2.25V6A2.25 2.25 0 016.75 3.75h10.5A2.25 2.25 0 0119.5 6v1.5"
      />
    </svg>
  );
}
