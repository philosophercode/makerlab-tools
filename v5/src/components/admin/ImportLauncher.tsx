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
  IMPORT_MAX_PDF_BYTES,
  IMPORT_MAX_TEXT_BYTES,
} from "../../lib/import/limits";

/**
 * **Import a list** (bulk intake spec §5 step 1): choose a file or paste.
 *
 * A file goes through the one upload route (`POST /api/uploads`, kind
 * `import`: private Blob, its type and size checks), then `POST /api/imports`
 * with the attachment id. When the deployment has no Blob store, a text file
 * is read in the browser and sent as text instead — the import still works, it
 * just keeps no copy of the file; a PDF needs the store and says so. A paste is
 * sent as text. Either way the page moves to the import, where a table's
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

export function ImportLauncher({ fetcher = fetch }: { fetcher?: typeof fetch }) {
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
    const form = new FormData();
    form.append("file", chosen);
    form.append("kind", "import");
    const upload = await fetcher("/api/uploads", { method: "POST", body: form });
    if (upload.status === 503) {
      // No Blob store: a text file can still be imported as its text.
      if (isPdf) {
        setError({ code: "blob_unavailable" });
        return;
      }
      await send({ text: await chosen.text(), sourceName: chosen.name });
      return;
    }
    const uploaded = (await upload.json().catch(() => ({}))) as { attachmentId?: string; code?: string };
    if (!upload.ok || !uploaded.attachmentId) {
      setError({ code: uploaded.code ?? (upload.status === 400 ? "unsupported_file" : "failed") });
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
      else if (text.trim()) await send({ text });
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
