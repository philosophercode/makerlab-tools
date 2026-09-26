"use client";

import { useRef, type FormEvent, type Ref } from "react";
import type { ChatStatus } from "ai";
import { FileTextIcon, MicIcon, PaperclipIcon, XIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputFooter,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from "../ai-elements/prompt-input";
import { Loader } from "../ai-elements/loader";
import { IMPORT_FILE_EXTENSIONS } from "../../lib/import/detect";
import { cn } from "@/lib/utils";
import type { ChatT } from "./chat-text";
import type { Dictation } from "./use-dictation";
import type { PendingDocument, PendingPhoto } from "./use-chat-attachments";

/** What the file picker offers: photos, and lists to import. */
const CHAT_FILE_ACCEPT = ["image/*", ...IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`)].join(",");

/**
 * The chat's composer (UI system phase 5b; DESIGN.md §8.11) on AI Elements'
 * `PromptInput`: what is attached (lists as named chips, photos as
 * thumbnails, each removable; an upload in flight; an upload's failure), the
 * text, then attach and dictate on the left and Send — the sheet's one
 * filled button — on the right. Enter sends, Shift+Enter is a new line.
 *
 * It holds no state: the draft, the attachments and dictation are the chat's,
 * so closing the sheet keeps them.
 */
export function ChatComposer({
  t,
  draft,
  onDraftChange,
  onSubmit,
  status,
  busy,
  photos,
  documents,
  uploadingCount,
  uploadError,
  onFiles,
  onRemovePhoto,
  onRemoveDocument,
  dictation,
  textareaRef,
}: {
  t: ChatT;
  draft: string;
  onDraftChange: (next: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  status: ChatStatus;
  /**
   * A turn is on its way: Send and the tools wait. The text stays enabled, so
   * focus stays in it (disabling the focused field would drop focus to the
   * sheet on every send) and the next question can be drafted meanwhile.
   */
  busy: boolean;
  photos: readonly PendingPhoto[];
  documents: readonly PendingDocument[];
  uploadingCount: number;
  uploadError: string | null;
  onFiles: (files: FileList | null) => void;
  onRemovePhoto: (key: string) => void;
  onRemoveDocument: (key: string) => void;
  dictation: Dictation;
  textareaRef?: Ref<HTMLTextAreaElement>;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const hasAttachments = photos.length > 0 || documents.length > 0 || uploadingCount > 0 || uploadError !== null;
  const canSend = (draft.trim().length > 0 || documents.length > 0) && !busy && uploadingCount === 0;

  return (
    <PromptInput onSubmit={onSubmit}>
      {hasAttachments ? (
        <PromptInputHeader aria-live="polite">
          {documents.map((doc) => (
            <div
              key={doc.key}
              className="inline-flex h-8 max-w-56 items-center gap-1.5 border border-border bg-background ps-2 text-xs"
            >
              <FileTextIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
              <span className="truncate">{doc.name}</span>
              <RemoveButton label={t("removeDocumentAria", { name: doc.name })} onClick={() => onRemoveDocument(doc.key)} />
            </div>
          ))}
          {photos.map((photo) => (
            <div key={photo.key} className="relative size-14 border border-border bg-background">
              {/* eslint-disable-next-line @next/next/no-img-element -- a local object URL, not an optimisable image */}
              <img src={photo.previewUrl} alt={photo.name} className="size-full object-cover" />
              <RemoveButton
                label={t("removePhotoAria", { name: photo.name })}
                onClick={() => onRemovePhoto(photo.key)}
                className="absolute end-0 top-0 bg-card/90"
              />
            </div>
          ))}
          {uploadingCount > 0 ? (
            <div
              role="img"
              aria-label={t("uploadingAria")}
              className="inline-flex size-14 items-center justify-center border border-dashed border-border text-muted-foreground"
            >
              <Loader size={14} />
            </div>
          ) : null}
          {uploadError ? (
            <p role="alert" className="basis-full text-xs text-bad">
              {uploadError}
            </p>
          ) : null}
        </PromptInputHeader>
      ) : null}

      <PromptInputBody>
        <PromptInputTextarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          placeholder={t("composerPlaceholder")}
          aria-label={t("composerAria")}
        />
      </PromptInputBody>

      <PromptInputFooter>
        <PromptInputTools>
          <input
            ref={fileInputRef}
            type="file"
            accept={CHAT_FILE_ACCEPT}
            multiple
            hidden
            onChange={(event) => {
              onFiles(event.target.files);
              // Allow re-selecting the same file.
              event.target.value = "";
            }}
          />
          <PromptInputButton
            aria-label={t("attachAria")}
            title={t("attachTitle")}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
          >
            <PaperclipIcon aria-hidden="true" />
          </PromptInputButton>
          {dictation.supported ? (
            <PromptInputButton
              aria-label={t("dictate")}
              aria-pressed={dictation.listening}
              title={t("dictate")}
              onClick={dictation.toggle}
              disabled={busy}
              className={cn(dictation.listening && "border-primary-ink text-primary-ink")}
            >
              <MicIcon aria-hidden="true" />
            </PromptInputButton>
          ) : null}
        </PromptInputTools>
        <PromptInputSubmit status={status} aria-label={t("sendAria")} disabled={!canSend} />
      </PromptInputFooter>
    </PromptInput>
  );
}

function RemoveButton({ label, onClick, className }: { label: string; onClick: () => void; className?: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={cn(
        "inline-flex size-6 shrink-0 cursor-pointer items-center justify-center text-muted-foreground transition-colors duration-150 hover:text-foreground",
        className
      )}
    >
      <XIcon aria-hidden="true" className="size-3.5" />
    </button>
  );
}
