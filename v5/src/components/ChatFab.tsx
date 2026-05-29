"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatLauncher } from "./ChatLauncherContext";

interface Suggestion {
  icon: "search" | "clipboard" | "pin";
  key: "suggestionFindMachine" | "suggestionTraining" | "suggestionSafety";
}

const SUGGESTIONS: Suggestion[] = [
  { icon: "search", key: "suggestionFindMachine" },
  { icon: "clipboard", key: "suggestionTraining" },
  { icon: "pin", key: "suggestionSafety" },
];

type ChatT = ReturnType<typeof useTranslations<"chat">>;

function toolStatusLabel(partType: string, t: ChatT): string {
  if (partType === "tool-get_unit_details") return t("lookingUpUnit");
  if (partType === "tool-report_issue") return t("filingTicket");
  return t("working");
}

function Icon({
  name,
}: {
  name: Suggestion["icon"] | "send" | "close" | "newchat" | "paperclip" | "remove";
}) {
  switch (name) {
    case "search":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      );
    case "clipboard":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <rect x="6" y="5" width="12" height="16" rx="1.5" />
          <path d="M9 5V4a2 2 0 1 1 6 0v1" />
          <path d="M9 11h6M9 15h4" />
        </svg>
      );
    case "pin":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 21s-7-5.2-7-11a7 7 0 1 1 14 0c0 5.8-7 11-7 11z" />
          <circle cx="12" cy="10" r="2.5" />
        </svg>
      );
    case "send":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 2 11 13" />
          <path d="m22 2-7 20-4-9-9-4 20-7z" />
        </svg>
      );
    case "close":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
    case "newchat":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z" />
        </svg>
      );
    case "paperclip":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66L9.41 17.41a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      );
    case "remove":
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      );
  }
}

interface PendingPhoto {
  key: string;
  file_upload_id: string;
  name: string;
  previewUrl: string;
}

export function ChatFab() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const { isOpen, open, close, pendingSeed, consumeSeed } = useChatLauncher();
  const [draft, setDraft] = useState("");
  const pathname = usePathname() || "/";
  const toolId = useMemo(() => {
    const match = pathname.match(/^\/tools\/(.+)$/);
    return match ? match[1] : undefined;
  }, [pathname]);

  // `useChat` bakes the transport into a ref on first mount and never refreshes
  // it (see @ai-sdk/react useChat — only `id`/`chat` prop changes recreate the
  // internal Chat). To make navigation update the toolId context without
  // resetting the conversation, we keep a stable transport that reads the
  // latest toolId and locale from refs at send time.
  const toolIdRef = useRef(toolId);
  useEffect(() => {
    toolIdRef.current = toolId;
  }, [toolId]);

  const localeRef = useRef(locale);
  useEffect(() => {
    localeRef.current = locale;
  }, [locale]);

  const transport = useMemo(
    () =>
      // eslint-disable-next-line react-hooks/refs -- the closure below runs at send time inside an event handler, not during render. Reading the refs there is safe.
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
          body: {
            id,
            messages,
            trigger,
            messageId,
            locale: localeRef.current,
            ...(toolIdRef.current ? { toolId: toolIdRef.current } : {}),
          },
        }),
      }),
    []
  );

  const [readingManuals, setReadingManuals] = useState<string[] | null>(null);
  const { messages, sendMessage, setMessages, status, error } = useChat({
    transport,
    onData: ({ type, data }) => {
      if (type === "data-manuals-attached") {
        const titles = (data as { titles?: string[] })?.titles;
        if (Array.isArray(titles) && titles.length > 0) setReadingManuals(titles);
      }
    },
  });
  const isLoading = status === "streaming" || status === "submitted";

  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const [uploadingCount, setUploadingCount] = useState(0);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
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

  function clearPendingPhotos() {
    setPendingPhotos((prev) => {
      prev.forEach((photo) => revokePreview(photo.previewUrl));
      return [];
    });
  }

  function clearChat() {
    setMessages([]);
    setDraft("");
    setReadingManuals(null);
    clearPendingPhotos();
    setUploadError(null);
  }

  function removePhoto(key: string) {
    setPendingPhotos((prev) => {
      const target = prev.find((p) => p.key === key);
      if (target) revokePreview(target.previewUrl);
      return prev.filter((p) => p.key !== key);
    });
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setUploadError(null);
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      setUploadError(t("onlyImages"));
      return;
    }

    setUploadingCount((n) => n + files.length);
    await Promise.all(
      files.map(async (file) => {
        const previewUrl = URL.createObjectURL(file);
        previewUrlsRef.current.add(previewUrl);
        try {
          const form = new FormData();
          form.append("file", file);
          const res = await fetch("/api/upload-notion", {
            method: "POST",
            body: form,
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => null)) as
              | { error?: string }
              | null;
            throw new Error(body?.error || "Upload failed");
          }
          const data = (await res.json()) as {
            file_upload_id: string;
            name: string;
          };
          setPendingPhotos((prev) => [
            ...prev,
            {
              key: `${data.file_upload_id}-${Date.now()}-${Math.random()}`,
              file_upload_id: data.file_upload_id,
              name: data.name,
              previewUrl,
            },
          ]);
        } catch (err) {
          revokePreview(previewUrl);
          const message =
            err instanceof Error ? err.message : t("uploadFailed");
          setUploadError(message);
        } finally {
          setUploadingCount((n) => Math.max(0, n - 1));
        }
      })
    );
  }

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const markdownComponents = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const target = typeof href === "string" ? href : "";
        const isInternal = target.startsWith("/");
        if (isInternal) {
          return (
            <Link href={target} onClick={close} className="chat-tool-link">
              {children}
            </Link>
          );
        }
        return (
          <a href={target} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [close]
  );

  // Send a message and clear the stale "Reading: …manuals…" indicator from any
  // previous turn. Clearing on send (rather than in an effect reacting to
  // `status`) keeps it next to where the request actually starts and avoids a
  // synchronous setState-in-effect cascade.
  function send(text: string) {
    setReadingManuals(null);
    sendMessage({ text });
  }

  // Auto-send a seeded message when something outside ChatFab (e.g. the nav
  // "Report" button) opens the chat with an intent. The nonce guard makes this
  // idempotent so a re-render never resends, and we wait until any in-flight
  // turn finishes before sending.
  const lastSeedNonce = useRef<number | null>(null);
  useEffect(() => {
    if (!pendingSeed || isLoading) return;
    if (lastSeedNonce.current !== pendingSeed.nonce) {
      lastSeedNonce.current = pendingSeed.nonce;
      send(pendingSeed.text);
    }
    consumeSeed();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `send`/`consumeSeed` are stable for this purpose; the nonce ref guards against resends.
  }, [pendingSeed, isLoading]);

  function handleSuggestion(label: string) {
    if (isLoading) return;
    send(label);
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isLoading || uploadingCount > 0) return;
    let outgoing = text;
    if (pendingPhotos.length > 0) {
      const hint = pendingPhotos
        .map(
          (p) => `file_upload_id=${p.file_upload_id} name=${p.name}`
        )
        .join("; ");
      outgoing = `${text}\n\n[Attached photos: ${hint}]`;
    }
    send(outgoing);
    setDraft("");
    clearPendingPhotos();
    setUploadError(null);
  }

  return (
    <>
      <button
        className="chat-fab"
        type="button"
        aria-expanded={isOpen}
        aria-controls="makerlab-chat-sheet"
        aria-label={t("openAria")}
        onClick={() => open()}
      >
        &gt;_
      </button>

      {isOpen ? (
        <div className="chat-overlay" role="dialog" aria-modal="true" aria-labelledby="chat-title">
          <button
            className="chat-scrim"
            type="button"
            aria-label={t("closeScrimAria")}
            onClick={close}
          />
          <section className="chat-sheet" id="makerlab-chat-sheet">
            <header className="chat-header">
              <h2 id="chat-title">{t("title")}</h2>
              <div className="chat-header-actions">
                {messages.length > 0 ? (
                  <button
                    type="button"
                    className="chat-close"
                    onClick={clearChat}
                    aria-label={t("newChatAria")}
                    title={t("newChatTitle")}
                  >
                    <Icon name="newchat" />
                  </button>
                ) : null}
                <button
                  type="button"
                  className="chat-close"
                  onClick={close}
                  aria-label={t("closeAria")}
                  title={t("closeTitle")}
                >
                  <Icon name="close" />
                </button>
              </div>
            </header>

            <div className="chat-body" ref={scrollRef}>
              {messages.length === 0 ? (
                <>
                  <p className="chat-greeting">
                    {toolId ? t("greetingTool") : t("greetingGeneral")}
                  </p>
                  <div className="chat-suggestions">
                    {SUGGESTIONS.map((suggestion) => {
                      const label = t(suggestion.key);
                      return (
                        <button
                          key={suggestion.key}
                          type="button"
                          className="chat-suggestion"
                          onClick={() => handleSuggestion(label)}
                          disabled={isLoading}
                        >
                          <span className="chat-suggestion-icon" aria-hidden="true">
                            <Icon name={suggestion.icon} />
                          </span>
                          <span>{label}</span>
                        </button>
                      );
                    })}
                  </div>
                </>
              ) : (
                <ul className="chat-messages">
                  {messages.map((message) => {
                    const textParts = message.parts.filter(
                      (p): p is Extract<typeof p, { type: "text" }> =>
                        p.type === "text" && p.text.trim().length > 0
                    );
                    const pendingTool = message.parts.find(
                      (p) =>
                        p.type.startsWith("tool-") &&
                        (p as { state?: string }).state !== "output-available"
                    );
                    if (textParts.length === 0 && !pendingTool) return null;
                    return (
                      <li key={message.id} className={`chat-msg chat-msg-${message.role}`}>
                        {textParts.length === 0 && pendingTool ? (
                          <p className="chat-reading" aria-label={t("toolRunningAria")}>
                            {toolStatusLabel(pendingTool.type, t)}
                          </p>
                        ) : null}
                        {textParts.map((part, index) =>
                          message.role === "assistant" ? (
                            <div key={index} className="chat-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {part.text}
                              </ReactMarkdown>
                            </div>
                          ) : (
                            <p key={index}>{part.text}</p>
                          )
                        )}
                      </li>
                    );
                  })}
                  {isLoading && messages[messages.length - 1]?.role !== "assistant" ? (
                    <li className="chat-msg chat-msg-assistant">
                      {readingManuals && readingManuals.length > 0 ? (
                        <p className="chat-reading" aria-label={t("readingManualsAria")}>
                          {t("reading", { titles: readingManuals.join(", ") })}
                        </p>
                      ) : (
                        <p className="chat-typing" aria-label={t("typingAria")}>
                          <span />
                          <span />
                          <span />
                        </p>
                      )}
                    </li>
                  ) : null}
                  {error ? (
                    <li className="chat-msg chat-msg-error">
                      <p>{t("error")}</p>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            {pendingPhotos.length > 0 || uploadingCount > 0 || uploadError ? (
              <div className="chat-attachments" aria-live="polite">
                {pendingPhotos.map((photo) => (
                  <div key={photo.key} className="chat-attachment">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={photo.previewUrl} alt={photo.name} />
                    <button
                      type="button"
                      className="chat-attachment-remove"
                      aria-label={t("removePhotoAria", { name: photo.name })}
                      onClick={() => removePhoto(photo.key)}
                    >
                      <Icon name="remove" />
                    </button>
                  </div>
                ))}
                {uploadingCount > 0 ? (
                  <div
                    className="chat-attachment chat-attachment-loading"
                    aria-label={t("uploadingAria")}
                  >
                    <span className="chat-attachment-spinner" />
                  </div>
                ) : null}
                {uploadError ? (
                  <p className="chat-attachment-error" role="alert">
                    {uploadError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <form className="chat-composer" onSubmit={handleSubmit}>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="chat-file-input"
                onChange={(event) => {
                  handleFiles(event.target.files);
                  // Allow re-selecting the same file.
                  event.target.value = "";
                }}
              />
              <button
                type="button"
                className="chat-attach"
                aria-label={t("attachAria")}
                title={t("attachTitle")}
                onClick={() => fileInputRef.current?.click()}
                disabled={isLoading}
              >
                <Icon name="paperclip" />
              </button>
              <input
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={t("composerPlaceholder")}
                aria-label={t("composerAria")}
                disabled={isLoading}
              />
              <button
                type="submit"
                className="chat-send"
                aria-label={t("sendAria")}
                disabled={!draft.trim() || isLoading || uploadingCount > 0}
              >
                <Icon name="send" />
              </button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
