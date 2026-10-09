"use client";

import { useId, useRef, type FormEvent, type Ref } from "react";
import type { ChatStatus } from "ai";
import { FileTextIcon, MicIcon, PlusIcon, XIcon } from "lucide-react";
import {
  PromptInput,
  PromptInputBody,
  PromptInputButton,
  PromptInputHeader,
  PromptInputSubmit,
  PromptInputTextarea,
} from "../ai-elements/prompt-input";
import { Loader } from "../ai-elements/loader";
import { IMPORT_FILE_EXTENSIONS } from "../../lib/import/detect";
import { PHOTO_ACCEPT } from "../../lib/images/photo-rules";
import { cn } from "@/lib/utils";
import { useAiNoteDismissed } from "./ai-note-store";
import type { ChatT } from "./chat-text";
import type { Dictation } from "./use-dictation";
import type { PendingDocument, PendingPhoto } from "./use-chat-attachments";

/**
 * What the file picker offers: photos — JPEG, PNG, WebP and an iPhone's HEIC
 * (`PHOTO_ACCEPT`) — and lists to import. Not `capture`, so a phone offers
 * both the camera and the library. iOS hands over HEIC as it is when the list
 * names it (and transcodes to JPEG when it does not); Safari reads either.
 */
const CHAT_FILE_ACCEPT =[...PHOTO_ACCEPT, ...IMPORT_FILE_EXTENSIONS.map((extension) => `.${extension}`)].join(",");

/**
 * The chat's composer (UI system phase 5b; DESIGN.md §8.11) on AI Elements'
 * `PromptInput`: what is attached (lists as named chips, photos as
 * thumbnails, each removable; an upload in flight; an upload's failure), then
 * one line (owner decision 2026-10-07): a round + to attach, the text, and on
 * the right the microphone until there is something to send, then Send — the
 * sheet's one filled button. While dictation runs the microphone stays, so it
 * can be stopped. Enter sends, Shift+Enter is a new line.
 *
 * Above it, a small note that the AI can be wrong (identity spec amendment
 * 2026-10-06), closed with its × and remembered in this browser. While shown
 * it also describes the text field, so a screen reader hears it there.
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
  const noteId = useId();
  const hasAttachments = photos.length > 0 || documents.length > 0 || uploadingCount > 0 || uploadError !== null;
  const hasContent = draft.trim().length > 0 || documents.length > 0;
  const canSend = hasContent && !busy && uploadingCount === 0;
  const showMic = dictation.supported && (dictation.listening || (!hasContent && !busy));
  const [noteDismissed, dismissNote] = useAiNoteDismissed();

  return (
    <>
      {noteDismissed ? null : (
        <div
          data-slot="chat-ai-note"
          className="mb-2 flex items-start gap-2 border border-border bg-muted/60 py-1.5 ps-3 pe-1.5 text-xs text-muted-foreground"
        >
          <p id={noteId} className="flex-1 py-0.5 text-pretty">
            {t("aiNote")}
          </p>
          <RemoveButton label={t("aiNoteDismiss")} onClick={dismissNote} />
        </div>
      )}
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
                {/* eslint-disable-next-line @next/next/no-img-element -- a local object or data: URL, not an optimisable image */}
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

        <div className="flex items-end gap-1.5 p-1.5">
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
            variant="outline"
            aria-label={t("attachAria")}
            title={t("attachTitle")}
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            className="composer-round size-9 shrink-0 border-border text-foreground"
          >
            <PlusIcon aria-hidden="true" />
          </PromptInputButton>
          <PromptInputBody>
            <PromptInputTextarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              placeholder={t("composerPlaceholder")}
              aria-label={t("composerAria")}
              aria-describedby={noteDismissed ? undefined : noteId}
              className="min-h-9 min-w-0 flex-1 px-1.5 py-1.5"
            />
          </PromptInputBody>
          {showMic ? (
            <PromptInputButton
              aria-label={t("dictate")}
              aria-pressed={dictation.listening}
              title={t("dictate")}
              onClick={dictation.toggle}
              className={cn("composer-round size-9 shrink-0 text-muted-foreground", dictation.listening && "bg-primary/15 text-primary-ink")}
            >
              <MicIcon aria-hidden="true" />
            </PromptInputButton>
          ) : (
            <PromptInputSubmit
              status={status}
              aria-label={t("sendAria")}
              disabled={!canSend}
              className="composer-round size-9 shrink-0"
            />
          )}
        </div>
      </PromptInput>
    </>
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
