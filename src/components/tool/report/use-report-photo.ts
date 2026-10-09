"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The quick report form's one optional photo (quick report spec §6). It goes
 * to `POST /api/uploads` as `kind: "maintenance"`: stored privately, so no URL
 * comes back and the form shows the local preview it already holds. The
 * report then sends the `attachmentId`, and the ticket claims it.
 *
 * Errors are codes the form translates. `unavailable` is the route's 503 (no
 * Blob store): the report can still be sent without a photo.
 */

export type ReportPhotoError = "unavailable" | "failed" | "notImage";

export interface ReportPhoto {
  id: string;
  name: string;
  previewUrl: string | null;
}

export function useReportPhoto() {
  const [photo, setPhoto] = useState<ReportPhoto | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<ReportPhotoError | null>(null);
  // The latest preview, so it is released when replaced, cleared or unmounted.
  const previewRef = useRef<string | null>(null);

  const release = useCallback(() => {
    if (previewRef.current && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(previewRef.current);
    previewRef.current = null;
  }, []);

  useEffect(() => release, [release]);

  const upload = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      setError(null);
      if (!file.type.startsWith("image/")) {
        setError("notImage");
        return;
      }
      setUploading(true);
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("kind", "maintenance");
        const res = await fetch("/api/uploads", { method: "POST", body: form });
        if (res.status === 503) {
          setError("unavailable");
          return;
        }
        if (!res.ok) {
          setError("failed");
          return;
        }
        const data = (await res.json()) as { attachmentId?: string; name?: string };
        if (!data.attachmentId) {
          setError("failed");
          return;
        }
        release();
        const previewUrl = typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null;
        previewRef.current = previewUrl;
        setPhoto({ id: data.attachmentId, name: data.name || file.name, previewUrl });
      } catch {
        setError("failed");
      } finally {
        setUploading(false);
      }
    },
    [release]
  );

  const clear = useCallback(() => {
    release();
    setPhoto(null);
    setError(null);
  }, [release]);

  return { photo, uploading, error, upload, clear };
}
