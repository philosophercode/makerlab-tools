"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { IMPORT_FILE_EXTENSIONS, extensionOf } from "../../lib/import/detect";
import { RowStatus } from "./RowStatus";
import { Field, hintId } from "../system/Field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  IMPORT_DOCUMENT_MAX_CHARS,
  IMPORT_DOCUMENT_MAX_PAGES,
  IMPORT_MAX_ITEMS,
  IMPORT_MAX_PASTE_BYTES,
  IMPORT_MAX_PDF_BYTES,
  IMPORT_MAX_TEXT_BYTES,
} from "../../lib/import/limits";
import { uploadImportFile, type ImportUploadDeps } from "../../lib/import/upload-import-file";

/**
 * **Import a list** (bulk intake spec §5 step 1): choose a file or paste.
 *
 * A file is uploaded private (`uploadImportFile`: through `POST /api/uploads`,
 * kind `import`, or — above the function's 4.5 MB body limit — from the
 * browser straight to Blob; import progress spec §3.5), then `POST /api/imports`
 * with the attachment id. When the deployment has no Blob store, a text file
 * is read in the browser and sent as text instead — the import still works, it
 * just keeps no copy of the file; a PDF needs the store and says so. A paste is
 * sent as text, up to 4 MB (`IMPORT_MAX_PASTE_BYTES`), checked here before it is sent. Either way the page moves to the import, where a table's
 * columns are confirmed and everything is reviewed before research.
 */

const ACCEPT = IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`).join(",");

/** The numbers a refusal's message needs (`too_many_items`, `document_too_long`). */
interface RefusalNumbers {
  limit?: number;
  count?: number;
  pages?: number;
  limitPages?: number;
  limitChars?: number;
}

interface ImportResponse extends RefusalNumbers {
  href?: string;
  code?: string;
}

export function ImportLauncher({ fetcher = fetch, upload }: { fetcher?: typeof fetch; upload?: ImportUploadDeps["upload"] }) {
  const t = useTranslations("admin.import");
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<({ code: string } & RefusalNumbers) | null>(null);

  async function send(body: Record<string, unknown>): Promise<void> {
    const res = await fetcher("/api/imports", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const answer = (await res.json().catch(() => ({}))) as ImportResponse;
    if (res.ok && answer.href) {
      router.push(answer.href);
      return;
    }
    setError({
      code: answer.code ?? "failed",
      limit: answer.limit,
      count: answer.count,
      pages: answer.pages,
      limitPages: answer.limitPages,
      limitChars: answer.limitChars,
    });
  }

  async function importFile(chosen: File) {
    const isPdf = extensionOf(chosen.name) === "pdf" || chosen.type === "application/pdf";
    if (chosen.size > (isPdf ? IMPORT_MAX_PDF_BYTES : IMPORT_MAX_TEXT_BYTES)) {
      setError({ code: "too_large" });
      return;
    }
    const uploaded = await uploadImportFile(chosen, { fetcher, upload });
    if (!uploaded.ok && uploaded.status === 503) {
      // No Blob store: a text file can still be imported as its text.
      if (isPdf) {
        setError({ code: "blob_unavailable" });
        return;
      }
      await send({ text: await chosen.text(), sourceName: chosen.name });
      return;
    }
    if (!uploaded.ok) {
      setError({ code: uploadErrorCode(uploaded.status, uploaded.code) });
      return;
    }
    await send({ attachmentId: uploaded.attachmentId, sourceName: chosen.name });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      if (file) await importFile(file);
      else if (text.trim()) {
        if (new TextEncoder().encode(text).byteLength > IMPORT_MAX_PASTE_BYTES) setError({ code: "paste_too_large" });
        else await send({ text });
      }
    } catch {
      setError({ code: "failed" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="ui grid max-w-[760px] gap-4" onSubmit={(event) => void submit(event)}>
      <Field id="import-file" label={t("launcher.fileLabel")} hint={t("launcher.fileHint")}>
        <Input
          id="import-file"
          type="file"
          accept={ACCEPT}
          disabled={busy}
          aria-describedby={hintId("import-file")}
          className="h-auto py-1"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </Field>
      <p className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{t("launcher.or")}</p>
      <Field id="import-paste" label={t("launcher.pasteLabel")} hint={t("launcher.pasteHint")}>
        <Textarea
          id="import-paste"
          rows={10}
          value={text}
          disabled={busy || file !== null}
          placeholder={t("launcher.pastePlaceholder")}
          aria-describedby={hintId("import-paste")}
          className="font-mono text-table"
          onChange={(event) => setText(event.target.value)}
        />
      </Field>
      {error ? (
        <RowStatus tone="bad" role="alert">
          {t(`errors.${error.code}`, {
            limit: error.limit ?? IMPORT_MAX_ITEMS,
            count: error.count ?? 0,
            pages: error.pages ?? 0,
            limitPages: error.limitPages ?? IMPORT_DOCUMENT_MAX_PAGES,
            limitChars: error.limitChars ?? IMPORT_DOCUMENT_MAX_CHARS,
            remaining: 0,
          })}
        </RowStatus>
      ) : null}
      <div>
        <Button type="submit" variant="default" disabled={busy || (!file && !text.trim())}>
          {busy ? t("launcher.importing") : t("launcher.submit")}
        </Button>
      </div>
    </form>
  );
}

/** The launcher's word for an upload the routes refused. */
function uploadErrorCode(status: number, code: string | undefined): string {
  // The platform's own refusal of a body over its limit carries no code of ours.
  if (status === 413 || code === "file_too_large") return "too_large";
  if (code === "unsupported_file") return "unsupported_file";
  if (code) return code;
  return status === 400 ? "unsupported_file" : "failed";
}
