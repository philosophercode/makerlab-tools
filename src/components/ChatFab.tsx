"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type FileUIPart } from "ai";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { ClipboardCheckIcon, MapPinIcon, SearchIcon, SquarePenIcon, XIcon } from "lucide-react";
import { useChatLauncher } from "./ChatLauncherContext";
import { siteConfig } from "../lib/site-config";
import { startGoogleSignIn } from "../lib/auth/sign-in-client";
import { toVisionFileParts, withRecentPhotos } from "../lib/chat/photo-parts";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Conversation, ConversationContent, ConversationScrollButton } from "./ai-elements/conversation";
import { Message, MessageContent } from "./ai-elements/message";
import { Suggestion, Suggestions } from "./ai-elements/suggestion";
import { Loader } from "./ai-elements/loader";
import { ChatMessage, preloadChatResponse } from "./chat/ChatMessage";
import { ChatComposer } from "./chat/ChatComposer";
import { parseCeiling } from "./chat/chat-text";
import { useChatAttachments } from "./chat/use-chat-attachments";
import { useDictation } from "./chat/use-dictation";
import { FROSTED } from "./system/frosted";
import { cn } from "@/lib/utils";

/** The generic starters, with the icon each chip carries. */
const SUGGESTIONS = [
  { icon: SearchIcon, key: "suggestionFindMachine" },
  { icon: ClipboardCheckIcon, key: "suggestionTraining" },
  { icon: MapPinIcon, key: "suggestionSafety" },
] as const;

/** A path segment as written, decoded when it can be. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

/** The admin opens the assistant from its section bar and ⌘K; the floating button is not drawn there. */
function isAdminPath(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

/**
 * The MakerLab assistant (UI system spec §9; phase 5b): a docked side sheet on
 * AI Elements, mounted once in the root layout so a conversation survives
 * navigation.
 *
 * - **Where it opens.** On public pages, the square button at the inline-end
 *   corner; on `/admin/*` that button is not drawn (it collided with bulk
 *   bars) and the section bar's **Ask the assistant** and ⌘K open it instead.
 *   Anything else — Report, Add equipment, the QR notice — opens it through
 *   `ChatLauncherContext`, optionally with a first message.
 * - **The sheet** (`ui/sheet`): 440px from `sm`, the whole screen on a phone,
 *   frosted, the focus trapped inside, Escape closes, focus returns to what
 *   opened it; closing keeps the conversation, the draft and the attachments.
 * - **The conversation** is `useChat` over `/api/chat` with a transport that
 *   reads the page's tool, pending item and locale at send time;
 *   `ChatMessage` draws each turn and `ChatComposer` the composer.
 */
export function ChatFab() {
  const t = useTranslations("chat");
  const locale = useLocale();
  const { isOpen, open, close, pendingSeed, consumeSeed, toolStarters, curate } = useChatLauncher();
  const [draft, setDraft] = useState("");
  const pathname = usePathname() || "/";
  const onAdmin = isAdminPath(pathname);
  const toolId = useMemo(() => {
    const match = pathname.match(/^\/tools\/(.+)$/);
    return match ? match[1] : undefined;
  }, [pathname]);
  // A pending item's preliminary page: the chat is told which item it shows,
  // so an admin can curate it (refresh research spec §12.3). The server
  // decides whether this caller may.
  const pendingId = useMemo(() => {
    const match = pathname.match(/^\/admin\/intake\/([0-9a-f-]{36})$/i);
    return match ? match[1] : undefined;
  }, [pathname]);
  // "Curate this entry" — offered while the page's record is one this viewer
  // may curate (its page registered it through the launcher).
  const curateHere = useMemo(() => {
    if (!curate) return false;
    const here = [toolId, toolId ? safeDecode(toolId) : undefined, pendingId].filter(Boolean);
    return curate.keys.some((key) => here.includes(key));
  }, [curate, toolId, pendingId]);

  // The starter chips: the showing tool's own questions when its page
  // registered some and the path still names it (spec amendment "Tool-specific
  // starter questions"), else the generic three. Tool questions are data,
  // English as researched; the generic ones are translated.
  const chips = useMemo(() => {
    const own =
      toolId && toolStarters && toolStarters.keys.some((key) => key === toolId || key === safeDecode(toolId))
        ? toolStarters.questions
        : [];
    const starters =
      own.length > 0
        ? own.map((question, n) => ({ key: `tool-${n}`, Icon: SUGGESTIONS[n % SUGGESTIONS.length].icon, label: question, send: question }))
        : SUGGESTIONS.map(({ key, icon }) => ({ key, Icon: icon, label: t(key), send: t(key) }));
    return curateHere
      ? [{ key: "curate", Icon: ClipboardCheckIcon, label: t("curateStarter"), send: t("curatePrompt") }, ...starters]
      : starters;
  }, [toolId, toolStarters, curateHere, t]);

  // `useChat` bakes the transport into a ref on first mount and never refreshes
  // it (see @ai-sdk/react useChat — only `id`/`chat` prop changes recreate the
  // internal Chat). To make navigation update the toolId context without
  // resetting the conversation, we keep a stable transport that reads the
  // latest toolId and locale from refs at send time.
  const toolIdRef = useRef(toolId);
  useEffect(() => {
    toolIdRef.current = toolId;
  }, [toolId]);

  const pendingIdRef = useRef(pendingId);
  useEffect(() => {
    pendingIdRef.current = pendingId;
  }, [pendingId]);

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
            // Every turn re-sends the conversation; keep earlier photos bounded
            // so their bytes do not ride along forever (Article 4).
            messages: withRecentPhotos(messages),
            trigger,
            messageId,
            locale: localeRef.current,
            ...(toolIdRef.current ? { toolId: toolIdRef.current } : {}),
            ...(pendingIdRef.current ? { pendingId: pendingIdRef.current } : {}),
          },
        }),
      }),
    []
  );

  // The Markdown renderer loads when the chat is first opened, not with every page.
  useEffect(() => {
    if (isOpen) preloadChatResponse();
  }, [isOpen]);

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
  // A refusal at the allowance ceiling is not an error state — see parseCeiling.
  const ceiling = parseCeiling(error);

  const attachments = useChatAttachments(t);
  const dictation = useDictation({ lang: locale, draft, setDraft });
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  function clearChat() {
    setMessages([]);
    setDraft("");
    setReadingManuals(null);
    attachments.clear();
  }

  // Send a message and clear the stale "Reading: …manuals…" indicator from any
  // previous turn. Clearing on send (rather than in an effect reacting to
  // `status`) keeps it next to where the request actually starts and avoids a
  // synchronous setState-in-effect cascade.
  function send(text: string, files: FileUIPart[] = []) {
    setReadingManuals(null);
    sendMessage(files.length > 0 ? { text, files } : { text });
  }

  // Auto-send a seeded message when something outside ChatFab (e.g. the nav
  // "Report" / "Add equipment" buttons, ⌘K's "Ask the assistant: …") opens the
  // chat with an intent. The nonce guard makes this idempotent so a re-render
  // never resends, and we wait until any in-flight turn finishes before sending.
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

  function handleSuggestion(text: string) {
    if (isLoading) return;
    send(text);
  }

  // Sign-in offered at the ceiling. Comes back to the page the conversation
  // started on, so the visitor lands where they were (spec §10).
  function handleCeilingSignIn() {
    void startGoogleSignIn(pathname);
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (dictation.listening) dictation.stop();
    // A list attached with no words is still a request: to import it.
    const text = draft.trim() || (attachments.documents.length > 0 ? t("importListMessage") : "");
    if (!text || isLoading || attachments.uploadingCount > 0) return;
    let outgoing = text;
    if (attachments.photos.length > 0) {
      const hint = attachments.photos.map((p) => `attachment_id=${p.attachmentId} name=${p.name}`).join("; ");
      outgoing = `${outgoing}\n\n[Attached photos: ${hint}]`;
    }
    if (attachments.documents.length > 0) {
      // Only the id and the name: the model hands the file to `start_import`
      // and never reads it (bulk intake spec §3.5).
      const hint = attachments.documents.map((d) => `attachment_id=${d.attachmentId} name=${d.name}`).join("; ");
      outgoing = `${outgoing}\n\n[Attached documents: ${hint}]`;
    }
    send(outgoing, toVisionFileParts(attachments.photos));
    setDraft("");
    attachments.clear();
  }

  // Where focus lands when the sheet opens: the composer where there is a
  // keyboard to type with; on touch, the sheet itself, so a phone does not
  // raise its keyboard over the starters. The sheet is opened from many
  // places (the button, the section bar, ⌘K, Report, the QR notice) rather
  // than one Radix trigger, so what had focus is remembered here and given it
  // back on close — Radix alone would return focus to a trigger it never had.
  const returnFocusRef = useRef<HTMLElement | null>(null);
  function focusOnOpen(event: Event) {
    event.preventDefault();
    const before = document.activeElement;
    returnFocusRef.current = before instanceof HTMLElement && before !== document.body ? before : null;
    const finePointer = typeof window.matchMedia === "function" && window.matchMedia("(pointer: fine)").matches;
    const composer = textareaRef.current;
    if (finePointer && composer && !composer.disabled) composer.focus();
    else sheetRef.current?.focus();
  }
  function returnFocusOnClose(event: Event) {
    event.preventDefault();
    const target = returnFocusRef.current;
    returnFocusRef.current = null;
    if (target?.isConnected) target.focus();
  }

  const showLoader = isLoading && messages[messages.length - 1]?.role !== "assistant";

  return (
    <>
      {onAdmin ? null : (
        <button
          type="button"
          data-slot="chat-launcher"
          aria-expanded={isOpen}
          aria-controls="makerlab-chat-sheet"
          aria-label={t("openAria")}
          title={t("openAria")}
          onClick={() => open()}
          className="ui fixed end-4 bottom-4 z-40 inline-flex size-12 cursor-pointer items-center justify-center border border-primary bg-primary font-mono text-sm font-bold text-primary-foreground transition-colors duration-150 hover:bg-primary/85 sm:end-6 sm:bottom-6"
        >
          <span aria-hidden="true">&gt;_</span>
        </button>
      )}

      <Sheet open={isOpen} onOpenChange={(next) => (next ? open() : close())}>
        <SheetContent
          ref={sheetRef}
          id="makerlab-chat-sheet"
          side="right"
          showCloseButton={false}
          aria-describedby={undefined}
          onOpenAutoFocus={focusOnOpen}
          onCloseAutoFocus={returnFocusOnClose}
          className={cn(FROSTED, "w-full gap-0 overflow-hidden border-0 p-0 sm:w-[440px] sm:border-s")}
        >
          <header className="flex shrink-0 items-center justify-between gap-3 border-b border-border px-4 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-3">
            <SheetTitle className="font-mono text-label tracking-[0.08em]">{t("title")}</SheetTitle>
            <div className="flex items-center gap-1">
              {messages.length > 0 ? (
                <Button variant="ghost" size="icon-sm" onClick={clearChat} aria-label={t("newChatAria")} title={t("newChatTitle")}>
                  <SquarePenIcon aria-hidden="true" className="size-4" />
                </Button>
              ) : null}
              <SheetClose asChild>
                <Button variant="ghost" size="icon-sm" aria-label={t("closeAria")} title={t("closeTitle")}>
                  <XIcon aria-hidden="true" className="size-4" />
                </Button>
              </SheetClose>
            </div>
          </header>

          <Conversation>
            <ConversationContent>
              {messages.length === 0 ? (
                <div className="flex flex-col gap-4">
                  <p className="text-sm text-muted-foreground">{toolId ? t("greetingTool") : t("greetingGeneral")}</p>
                  <Suggestions>
                    {chips.map(({ key, Icon, label, send: text }) => (
                      <Suggestion key={key} suggestion={text} onClick={handleSuggestion} disabled={isLoading}>
                        <Icon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                        <span>{label}</span>
                      </Suggestion>
                    ))}
                  </Suggestions>
                </div>
              ) : (
                <>
                  {messages.map((message) => (
                    <ChatMessage key={message.id} message={message} t={t} onInternalNavigate={close} />
                  ))}
                  {showLoader ? (
                    <Message from="assistant">
                      <MessageContent>
                        {readingManuals && readingManuals.length > 0 ? (
                          <p aria-label={t("readingManualsAria")} className="flex items-center gap-2 font-mono text-label text-muted-foreground">
                            <Loader size={12} className="text-primary-ink" />
                            {t("reading", { titles: readingManuals.join(", ") })}
                          </p>
                        ) : (
                          <Loader role="img" aria-label={t("typingAria")} className="text-muted-foreground" />
                        )}
                      </MessageContent>
                    </Message>
                  ) : null}
                  {ceiling ? (
                    <Message from="assistant" kind="notice">
                      <MessageContent>
                        <p>
                          {ceiling === "sign-in"
                            ? t("rateLimitSignIn", { institution: siteConfig.institution })
                            : t("rateLimited")}
                        </p>
                        {ceiling === "sign-in" ? (
                          <p>
                            <Button variant="link" onClick={handleCeilingSignIn}>
                              {t("rateLimitSignInCta")}
                            </Button>
                          </p>
                        ) : null}
                      </MessageContent>
                    </Message>
                  ) : error ? (
                    <Message from="assistant" kind="error" role="alert">
                      <MessageContent>
                        <p>{error.message?.trim() ? error.message : t("error")}</p>
                      </MessageContent>
                    </Message>
                  ) : null}
                </>
              )}
            </ConversationContent>
            <ConversationScrollButton label={t("scrollToLatest")} />
          </Conversation>

          <div className="shrink-0 border-t border-border p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
            <ChatComposer
              t={t}
              draft={draft}
              onDraftChange={setDraft}
              onSubmit={handleSubmit}
              status={status}
              busy={isLoading}
              photos={attachments.photos}
              documents={attachments.documents}
              uploadingCount={attachments.uploadingCount}
              uploadError={attachments.uploadError}
              onFiles={(files) => void attachments.handleFiles(files)}
              onRemovePhoto={attachments.removePhoto}
              onRemoveDocument={attachments.removeDocument}
              dictation={dictation}
              textareaRef={textareaRef}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
