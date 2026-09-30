"use client";

import { useEffect, useRef, useState } from "react";
import { downscaleForVision } from "../../lib/chat/downscale-image";
import { isImportFileName } from "../../lib/import/detect";
import type { ChatT } from "./chat-text";

/**
 * What the composer has attached and not yet sent (moved out of `ChatFab`
 * unchanged in phase 5b): photos, uploaded the moment they are picked, and
 * lists to import.
 *
 * - A **photo** goes to `POST /api/uploads` (kind `chat`, stored privately —
 *   it may show a person), and a downscaled copy is made beside it for the
 *   model to look at (intake spec §6.1). The preview is a local object URL,
 *   revoked when the photo is removed, sent or the chat unmounts.
 * - A **list** (CSV, TSV, text or PDF) is uploaded private as kind `import`,
 *   staff only, and named to the model by its id so `start_import` can read
 *   it — the model never sees its contents (bulk intake spec §3.5).
 * - With no Blob store the route answers 503, and the visitor is told, in
 *   their language, that they can still send without a photo (Article 4).
 */

export interface PendingPhoto {
  key: string;
  /** `attachments.id` from `POST /api/uploads` — a Postgres uuid. */
  attachmentId: string;
  name: string;
  previewUrl: string;
  /** Downscaled copy the model sees; absent when the browser could not encode it. */
  dataUrl?: string;
}

export interface PendingDocument {
  key: string;
  attachmentId: string;
  name: string;
}

export function useChatAttachments(t: ChatT) {
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);
  const [documents, setDocuments] = useState<PendingDocument[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  // Track preview URLs so we can revoke them on unmount.
  const previewUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const urls = previewUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  function revokePreview(url: string) {
    if (previewUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      previewUrlsRef.current.delete(url);
    }
  }

  function removePhoto(key: string) {
    setPhotos((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) revokePreview(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  function removeDocument(key: string) {
    setDocuments((prev) => prev.filter((d) => d.key !== key));
  }

  /** Forget everything attached (after a send, or a new chat). */
  function clear() {
    setPhotos((prev) => {
      prev.forEach((photo) => revokePreview(photo.previewUrl));
      return [];
    });
    setDocuments([]);
    setUploadError(null);
  }

  /** Upload one list to import; staff only, so a student is told so rather than shown an error. */
  async function uploadDocument(file: File) {
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "import");
    const res = await fetch("/api/uploads", { method: "POST", body: form });
    if (res.status === 503) throw new Error(t("uploadsUnavailable"));
    if (res.status === 401 || res.status === 403) throw new Error(t("documentsStaffOnly"));
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error || t("uploadFailed"));
    }
    const data = (await res.json()) as { attachmentId: string; name: string };
    setDocuments((prev) => [
      ...prev,
      { key: `${data.attachmentId}-${Date.now()}`, attachmentId: data.attachmentId, name: data.name || file.name },
    ]);
  }

  async function uploadPhoto(file: File) {
    const previewUrl = URL.createObjectURL(file);
    previewUrlsRef.current.add(previewUrl);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("kind", "chat");
      // The stored upload is the record; the downscaled copy is what the
      // model looks at (intake spec §6.1). They run side by side, and a
      // photo the browser cannot encode still uploads.
      const [res, dataUrl] = await Promise.all([fetch("/api/uploads", { method: "POST", body: form }), downscaleForVision(file)]);
      if (res.status === 503) {
        // No Blob store is configured, so there is nowhere to keep the
        // photo. Say so in the visitor's language and let them send the
        // message anyway — a report without a picture still beats no
        // report (Article 4).
        throw new Error(t("uploadsUnavailable"));
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || t("uploadFailed"));
      }
      const data = (await res.json()) as { attachmentId: string; name: string };
      setPhotos((prev) => [
        ...prev,
        {
          key: `${data.attachmentId}-${Date.now()}-${Math.random()}`,
          attachmentId: data.attachmentId,
          name: data.name,
          // A chat photo is stored privately (it may show a person), so
          // the response carries no URL — the local object URL made above
          // is the preview, and always was.
          previewUrl,
          dataUrl: dataUrl ?? undefined,
        },
      ]);
    } catch (err) {
      revokePreview(previewUrl);
      setUploadError(err instanceof Error ? err.message : t("uploadFailed"));
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const all = Array.from(fileList);
    const lists = all.filter((f) => !f.type.startsWith("image/") && isImportFileName(f.name));
    const images = all.filter((f) => f.type.startsWith("image/"));
    if (images.length === 0 && lists.length === 0) {
      setUploadError(t("onlyImages"));
      return;
    }
    if (lists.length > 0) {
      setUploadingCount((n) => n + lists.length);
      await Promise.all(
        lists.map(async (file) => {
          try {
            await uploadDocument(file);
          } catch (err) {
            setUploadError(err instanceof Error ? err.message : t("uploadFailed"));
          } finally {
            setUploadingCount((n) => Math.max(0, n - 1));
          }
        })
      );
    }
    if (images.length === 0) return;
    setUploadingCount((n) => n + images.length);
    await Promise.all(
      images.map(async (file) => {
        try {
          await uploadPhoto(file);
        } finally {
          setUploadingCount((n) => Math.max(0, n - 1));
        }
      })
    );
  }

  return { photos, documents, uploadingCount, uploadError, handleFiles, removePhoto, removeDocument, clear };
}
