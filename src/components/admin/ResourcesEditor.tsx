"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import type { EditorResource, NewResource } from "../../lib/data/resources";
import { ManualStateTag } from "./ManualStateTag";
import { uploadFile, type UploadFailure } from "./upload-file";
import { RowStatus } from "./RowStatus";
import { EmptyState } from "../system/EmptyState";
import { AsyncButton } from "../system/AsyncButton";

/**
 * The Resources section of the tool editor — manuals, SOPs and links
 * (spec §5.3(3), §4.6).
 *
 * A resource is a URL, an uploaded PDF, or both. **The PDF is uploaded before
 * the resource exists**: `POST /api/uploads` writes the blob and an unowned
 * `attachments` row, and the add claims its id. That is why the file is chosen
 * here and the claim happens on the server (§3.3).
 *
 * **With no Blob store the file half goes away and the rest does not.** The
 * upload route answers 503 and this section says so, keeps the link field
 * working, and leaves every existing resource editable — a deployment without
 * `BLOB_READ_WRITE_TOKEN` is still one where a wrong link is worth fixing
 * (Article 4).
 *
 * **Unpublished resources are shown**, unlike everywhere else in the app: the
 * editor is exactly where somebody goes to look at the manual they hid.
 */

export interface ResourcesEditorProps {
  resources: EditorResource[];
  pending: boolean;
  onAdd: (resource: NewResource, fileAttachmentIds: string[]) => void;
  onTogglePublished: (resourceId: string, published: boolean) => void;
  onRemove: (resourceId: string) => void;
  /** Re-process the resource's manual PDF (manual text spec §5). Offered only on a row with a PDF. */
  onReprocess?: (resourceId: string) => Promise<boolean>;
}

export function ResourcesEditor({
  resources,
  pending,
  onAdd,
  onTogglePublished,
  onRemove,
  onReprocess,
}: ResourcesEditorProps) {
  const t = useTranslations("admin.inventory.editor");

  const [title, setTitle] = useState("");
  const [type, setType] = useState("");
  const [url, setUrl] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<UploadFailure | null>(null);

  async function handleAdd(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;
    setUploadError(null);

    // The file is uploaded first and the resource claims what actually landed:
    // an id invented after a failed upload would be a manual nobody has.
    let fileAttachmentIds: string[] = [];
    if (file) {
      setUploading(true);
      const uploaded = await uploadFile(file, "resource");
      setUploading(false);
      if (!uploaded.ok) {
        setUploadError(uploaded.reason);
        return;
      }
      fileAttachmentIds = [uploaded.attachmentId];
    }

    onAdd(
      { title: trimmed, type: type.trim() || null, url: url.trim() || null },
      fileAttachmentIds
    );
    setTitle("");
    setType("");
    setUrl("");
    setFile(null);
  }

  return (
    <div className="admin-editor-resources">
      {resources.length === 0 ? (
        <EmptyState>{t("noResources")}</EmptyState>
      ) : (
        <ul className="admin-resource-list">
          {resources.map((resource) => (
            <li key={resource.id} className={resource.published ? undefined : "is-unpublished"}>
              <div className="admin-resource-head">
                <span className="admin-resource-title">{resource.title}</span>
                {resource.type ? (
                  <span className="admin-cell-note">{resource.type}</span>
                ) : null}
                {!resource.published ? (
                  <span className="admin-tag">{t("resourceHidden")}</span>
                ) : null}
                {resource.manual ? <ManualStateTag state={resource.manual} /> : null}
              </div>

              {resource.url ? (
                <a className="admin-resource-link" href={resource.url} rel="noreferrer noopener" target="_blank">
                  {resource.url}
                </a>
              ) : null}
              {resource.fileUrls.map((fileUrl) => (
                <a
                  key={fileUrl}
                  className="admin-resource-link"
                  href={fileUrl}
                  rel="noreferrer noopener"
                  target="_blank"
                >
                  {t("resourceFile")}
                </a>
              ))}

              <div className="admin-unit-actions">
                <button
                  type="button"
                  className="admin-button"
                  disabled={pending}
                  onClick={() => onTogglePublished(resource.id, !resource.published)}
                >
                  {resource.published ? t("hideResource") : t("showResource")}
                </button>
                {resource.manual && onReprocess ? (
                  <AsyncButton
                    size="sm"
                    disabled={pending}
                    title={t("reprocessManualTitle")}
                    onRun={() => onReprocess(resource.id)}
                    doneLabel={t("reprocessStarted")}
                  >
                    {t("reprocessManual")}
                  </AsyncButton>
                ) : null}
                <button
                  type="button"
                  className="admin-button is-danger"
                  disabled={pending}
                  onClick={() => onRemove(resource.id)}
                >
                  {t("removeResource")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <form className="admin-inline-form" onSubmit={handleAdd}>
        <label className="admin-field">
          <span>{t("resourceTitle")}</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} />
        </label>

        <label className="admin-field">
          <span>{t("resourceType")}</span>
          <input
            value={type}
            placeholder={t("resourceTypePlaceholder")}
            onChange={(event) => setType(event.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>{t("resourceUrl")}</span>
          <input
            value={url}
            placeholder="https://"
            onChange={(event) => setUrl(event.target.value)}
          />
        </label>

        <label className="admin-field">
          <span>{t("resourceFileField")}</span>
          <input
            type="file"
            accept="application/pdf"
            onChange={(event) => setFile(event.target.files?.[0] ?? null)}
          />
        </label>

        <button
          type="submit"
          className="admin-button"
          disabled={pending || uploading || !title.trim()}
        >
          {uploading ? t("uploading") : t("addResource")}
        </button>

        {uploadError ? (
          <RowStatus tone="bad">{t(`uploadErrors.${uploadError}`)}</RowStatus>
        ) : null}
      </form>
    </div>
  );
}
