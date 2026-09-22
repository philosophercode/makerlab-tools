"use client";

import Image from "next/image";
import { useState } from "react";
import { useTranslations } from "next-intl";
import type { EditorPhoto } from "../../lib/data/tool-editor";
import { uploadFile, type UploadFailure } from "./upload-file";

/**
 * The Photos section of the tool editor (spec §5.3(3), §4.7).
 *
 * **Position 0 is the cover**, so "make this the cover" and "reorder" are the
 * same operation: moving a photo to the front is how a cover is chosen, and
 * there is no second concept to keep in step.
 *
 * **Move buttons rather than drag-and-drop.** The panel is used on a phone
 * standing next to a machine, and a drag target inside a scrolling sheet is the
 * control that fails there. Two buttons work with a thumb, a keyboard and a
 * screen reader.
 *
 * **With no Blob store, adding goes away and the rest stays.** `POST /api/uploads`
 * answers 503 when `BLOB_READ_WRITE_TOKEN` is unset; this says photos cannot be
 * added right now and leaves reordering and removal — which touch only rows —
 * working (Article 4).
 */

export interface PhotoEditorProps {
  photos: EditorPhoto[];
  pending: boolean;
  onAttach: (attachmentIds: string[]) => void;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (attachmentId: string) => void;
}

export function PhotoEditor({
  photos,
  pending,
  onAttach,
  onReorder,
  onRemove,
}: PhotoEditorProps) {
  const t = useTranslations("admin.inventory.editor");
  const [uploading, setUploading] = useState(0);
  const [uploadError, setUploadError] = useState<UploadFailure | null>(null);

  async function handleFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    setUploadError(null);

    const files = Array.from(list);
    setUploading(files.length);

    // Uploaded in parallel, claimed in one write: the claim is what decides the
    // order, and one write means one revision to hand back to the panel.
    const results = await Promise.all(files.map((file) => uploadFile(file, "tool")));
    setUploading(0);

    const attachmentIds = results
      .filter((result) => result.ok)
      .map((result) => (result.ok ? result.attachmentId : ""));

    // The first failure is the one reported: with no Blob store every file
    // fails the same way, and five copies of that sentence is not five facts.
    const failure = results.find((result) => !result.ok);
    if (failure && !failure.ok) setUploadError(failure.reason);

    if (attachmentIds.length > 0) onAttach(attachmentIds);
  }

  function move(index: number, delta: number) {
    const next = [...photos.map((photo) => photo.id)];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onReorder(next);
  }

  return (
    <div className="admin-editor-photos">
      {photos.length === 0 ? (
        <p className="admin-empty td-empty">{t("noPhotos")}</p>
      ) : (
        <ul className="admin-photo-list">
          {photos.map((photo, index) => (
            <li key={photo.id} className="admin-photo">
              <span className="admin-thumb">
                {photo.url ? (
                  <Image
                    src={photo.url}
                    alt={photo.originalFilename ?? ""}
                    fill
                    sizes="96px"
                    style={{ objectFit: "cover" }}
                    unoptimized
                  />
                ) : null}
              </span>

              {index === 0 ? <span className="admin-tag">{t("coverPhoto")}</span> : null}

              <div className="admin-unit-actions">
                <button
                  type="button"
                  className="admin-button"
                  disabled={pending || index === 0}
                  onClick={() => move(index, -1)}
                >
                  {t("movePhotoEarlier")}
                </button>
                <button
                  type="button"
                  className="admin-button"
                  disabled={pending || index === photos.length - 1}
                  onClick={() => move(index, 1)}
                >
                  {t("movePhotoLater")}
                </button>
                <button
                  type="button"
                  className="admin-button is-danger"
                  disabled={pending}
                  onClick={() => onRemove(photo.id)}
                >
                  {t("removePhoto")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <label className="admin-field">
        <span>{t("addPhotos")}</span>
        <input
          type="file"
          accept="image/*"
          multiple
          disabled={pending || uploading > 0}
          onChange={(event) => void handleFiles(event.target.files)}
        />
      </label>

      <p className="admin-row-status" role="status">
        {uploading > 0 ? t("uploading") : null}
      </p>
      {uploadError ? (
        <p className="admin-row-status is-error">{t(`uploadErrors.${uploadError}`)}</p>
      ) : null}
    </div>
  );
}
