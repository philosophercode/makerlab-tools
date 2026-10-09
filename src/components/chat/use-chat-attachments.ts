"use client";

import { useEffect, useRef, useState } from "react";
import { preparePhoto, type PreparedPhoto } from "../../lib/chat/downscale-image";
import { isPhotoFile } from "../../lib/images/photo-rules";
import { isImportFileName } from "../../lib/import/detect";
import type { ChatT } from "./chat-text";

/**
 * What the composer has attached and not yet sent (moved out of `ChatFab`
 * unchanged in phase 5b): photos, uploaded the moment they are picked, and
 * lists to import.
 *
 * - A **photo** goes to `POST /api/uploads` (kind `chat`, stored privately —
 *   it may show a person). It is downsized first (`preparePhoto`: at most
 *   2048 px, JPEG, upright, no EXIF), and a 1568 px copy is made beside it for
 *   the model (intake spec §6.1). A photo this browser cannot read (HEIC
 *   outside Safari) is uploaded as it is, and the route converts it and
 *   answers with the model's copy (data platform spec amendment 2026-10-08).
 *   The preview is a local object URL, revoked when the photo is removed, sent
 *   or the chat unmounts — or the route's copy, for a photo the browser could
 *   not draw.
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
  /** The name the photo was picked under (`IMG_0412.HEIC`), whatever it was uploaded as. */
  name: string;
  previewUrl: string;
  /** Downscaled copy the model sees; absent when neither the browser nor the route could make one. */
  dataUrl?: string;
}

/** What `POST /api/uploads` answers for a photo. */
interface UploadedPhotoResponse {
  attachmentId: string;
  name: string;
  /** The model's copy of a photo the route converted (HEIC); absent otherwise. */
  visionDataUrl?: string;
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
  // The tail of the one-at-a-time photo preparation (`preparedInTurn`).
  const prepareQueueRef = useRef<Promise<unknown>>(Promise.resolve());

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

  /**
   * `preparePhoto`, one photo at a time: a 12 MP photo is about 48 MB once
   * decoded, and five picked at once on a phone would hold them all together.
   * The uploads that follow still overlap.
   */
  function preparedInTurn(file: File): Promise<PreparedPhoto> {
    // `preparePhoto` answers rather than throws; should it ever throw, the
    // original goes up and the route decides, as for a photo it cannot read.
    const next = prepareQueueRef.current
      .then(() => preparePhoto(file))
      .catch((): PreparedPhoto => ({ kind: "original", upload: file }));
    prepareQueueRef.current = next;
    return next;
  }

  async function uploadPhoto(file: File) {
    // Downsized here when this browser can read the photo; refused before any
    // upload when it is too large for either path.
    const prepared = await preparedInTurn(file);
    if (prepared.kind === "tooLarge") {
      setUploadError(t("photoTooLarge"));
      return;
    }
    // The preview is what was drawn here (upright, small) — or, for a photo
    // this browser could not read, the route's converted copy below.
    const localPreview = prepared.kind === "ready" ? trackedObjectUrl(prepared.upload) : null;
    try {
      const form = new FormData();
      form.append("file", prepared.upload);
      form.append("kind", "chat");
      const res = await fetch("/api/uploads", { method: "POST", body: form });
      if (res.status === 503) {
        // No Blob store is configured, so there is nowhere to keep the
        // photo. Say so in the visitor's language and let them send the
        // message anyway — a report without a picture still beats no
        // report (Article 4).
        throw new Error(t("uploadsUnavailable"));
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; code?: string } | null;
        throw new Error(photoUploadErrorText(t, res.status, body));
      }
      const data = (await res.json()) as UploadedPhotoResponse;
      // The stored upload is the record; the vision copy is what the model
      // looks at (intake spec §6.1) — made here, or by the route for a photo
      // it converted.
      const dataUrl = prepared.kind === "ready" ? prepared.visionDataUrl : data.visionDataUrl;
      // A chat photo is stored privately (it may show a person), so the
      // response carries no URL to show.
      const previewUrl = localPreview ?? data.visionDataUrl ?? trackedObjectUrl(file);
      setPhotos((prev) => [
        ...prev,
        {
          key: `${data.attachmentId}-${Date.now()}-${Math.random()}`,
          attachmentId: data.attachmentId,
          name: file.name || data.name,
          previewUrl,
          dataUrl: dataUrl ?? undefined,
        },
      ]);
    } catch (err) {
      if (localPreview) revokePreview(localPreview);
      setUploadError(err instanceof Error ? err.message : t("uploadFailed"));
    }
  }

  /** An object URL of `file`, revoked with the others. */
  function trackedObjectUrl(file: Blob): string {
    const url = URL.createObjectURL(file);
    previewUrlsRef.current.add(url);
    return url;
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const all = Array.from(fileList);
    // A photo is anything typed as an image, or an untyped `.heic`/`.heif`
    // (Chrome on Windows gives an iPhone photo no type).
    const images = all.filter(isPhotoFile);
    const lists = all.filter((f) => !isPhotoFile(f) && isImportFileName(f.name));
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

/**
 * What to tell somebody whose photo the route refused, in their language: a
 * format it cannot read, or a file too large — the route's own limit, or the
 * platform's 413 before the route ran. Anything else keeps the route's words.
 */
export function photoUploadErrorText(
  t: ChatT,
  status: number,
  body: { error?: string; code?: string } | null
): string {
  if (body?.code === "unsupported_image") return t("photoUnsupported");
  if (status === 413 || body?.code === "file_too_large") return t("photoTooLarge");
  return body?.error || t("uploadFailed");
}
