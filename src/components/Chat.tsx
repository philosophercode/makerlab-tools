"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage } from "ai";
import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useChatStore } from "@/components/ChatProvider";

interface ChatProps {
  toolId?: string;
  suggestions?: string[];
  header?: string;
}

/** Fix malformed markdown lists where the bullet and content are on separate lines */
function normalizeMarkdown(text: string): string {
  return text
    // Fix: "- \n\nContent" or "* \n\nContent" → "- Content"
    .replace(/^([*-])\s*\n\n+/gm, "$1 ")
    // Fix: "- \nContent" → "- Content"
    .replace(/^([*-])\s*\n(?!\n)/gm, "$1 ")
    // Collapse blank lines between consecutive list items to prevent loose lists
    .replace(/^([*-] .+)\n\n+(?=[*-] )/gm, "$1\n");
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function isImageFilePart(part: unknown): part is { type: "file"; mediaType: string } {
  if (!part || typeof part !== "object") return false;
  const p = part as { type?: string; mediaType?: string };
  return p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/");
}

function sanitizeMessagesForTransport(messages: UIMessage[]): UIMessage[] {
  let lastUserImageIndex = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (
      m.role === "user" &&
      Array.isArray(m.parts) &&
      m.parts.some((part) => isImageFilePart(part))
    ) {
      lastUserImageIndex = i;
      break;
    }
  }

  return messages.map((m, index) => {
    if (!Array.isArray(m.parts)) return m;
    const keepImageParts = index === lastUserImageIndex;
    const parts = m.parts.filter((part) => {
      if (!isImageFilePart(part)) return true;
      return keepImageParts;
    });
    return { ...m, parts };
  });
}

async function compressImageToDataUrl(file: File): Promise<{ dataUrl: string; mediaType: string }> {
  const MAX_DIMENSION = 1024;
  const MAX_SIZE_BYTES = 150_000;

  if (file.size <= MAX_SIZE_BYTES && file.type.startsWith("image/")) {
    return { dataUrl: await fileToBase64(file), mediaType: file.type };
  }

  const srcDataUrl = await fileToBase64(file);
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Could not load image for compression"));
    el.src = srcDataUrl;
  });

  const ratio = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const width = Math.max(1, Math.round(img.width * ratio));
  const height = Math.max(1, Math.round(img.height * ratio));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return { dataUrl: srcDataUrl, mediaType: file.type || "image/jpeg" };
  }
  ctx.drawImage(img, 0, 0, width, height);

  const qualities = [0.7, 0.5, 0.35, 0.2];
  let best = canvas.toDataURL("image/jpeg", qualities[0]);
  for (const q of qualities) {
    const candidate = canvas.toDataURL("image/jpeg", q);
    const estimatedBytes = Math.floor(((candidate.length - "data:image/jpeg;base64,".length) * 3) / 4);
    best = candidate;
    if (estimatedBytes <= MAX_SIZE_BYTES) break;
  }

  return { dataUrl: best, mediaType: "image/jpeg" };
}

export default function Chat({ toolId, suggestions, header }: ChatProps) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const userScrolledUp = useRef(false);
  const [pendingImage, setPendingImage] = useState<{ file: File; preview: string } | null>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);

  const conversationId = toolId ? `tool:${toolId}` : "general";
  const { getMessages, setMessages: storeMessages, clearConversation } = useChatStore();
  const initialMessages = getMessages(conversationId);

  const { messages, setMessages, sendMessage, stop, status, error } = useChat({
    transport: new DefaultChatTransport({
      api: "/api/chat",
      body: toolId ? { toolId } : undefined,
      prepareSendMessagesRequest: ({ id, messages: outgoingMessages, body, trigger, messageId }) => ({
        body: {
          ...body,
          id,
          messages: sanitizeMessagesForTransport(outgoingMessages),
          trigger,
          messageId,
        },
      }),
    }),
    messages: initialMessages.length > 0 ? initialMessages : undefined,
  });

  const isLoading = status === "streaming" || status === "submitted";

  // Sync messages to localStorage store
  const prevLengthRef = useRef(initialMessages.length);
  useEffect(() => {
    if (messages.length !== prevLengthRef.current && messages.length > 0) {
      storeMessages(conversationId, messages);
      prevLengthRef.current = messages.length;
    }
  }, [messages, conversationId, storeMessages]);

  // Save final state when streaming completes
  const prevLoadingRef = useRef(false);
  useEffect(() => {
    if (prevLoadingRef.current && !isLoading && messages.length > 0) {
      storeMessages(conversationId, messages);
    }
    prevLoadingRef.current = isLoading;
  }, [isLoading, messages, conversationId, storeMessages]);

  // Extract dynamic suggestions from the last assistant message
  const dynamicSuggestions = useMemo(() => {
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return null;
    for (const part of lastAssistant.parts) {
      const p = part as { type?: string; toolCallId?: string; output?: unknown; input?: { suggestions?: string[] } };
      if (p.type === "tool-suggest_followups" && p.toolCallId) {
        // Try output first (from execute), fall back to input
        if (Array.isArray(p.output)) return p.output as string[];
        if (Array.isArray(p.input?.suggestions)) return p.input.suggestions;
      }
    }
    return null;
  }, [messages]);

  const activeSuggestions = dynamicSuggestions || suggestions;

  // Detect if an image generation tool is currently executing (called but no image yet)
  const imageGenStatus = useMemo(() => {
    if (!isLoading) return null;
    const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
    if (!lastAssistant) return null;
    const hasVisualizeTool = lastAssistant.parts.some(
      (p) => (p as { type?: string }).type === "tool-visualize_project"
    );
    const hasInfographicTool = lastAssistant.parts.some(
      (p) => (p as { type?: string }).type === "tool-generate_infographic"
    );
    if (!hasVisualizeTool && !hasInfographicTool) return null;
    const hasImage = lastAssistant.parts.some(
      (p) => p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/")
    );
    if (hasImage) return null;
    return hasInfographicTool ? "infographic" : "image";
  }, [messages, isLoading]);

  // Track if user has scrolled up
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    userScrolledUp.current = distanceFromBottom > 100;
  }, []);

  // Scroll to bottom on initial mount when restoring conversation
  useEffect(() => {
    if (scrollRef.current && messages.length > 0) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Smart auto-scroll: only scroll if user is near the bottom
  useEffect(() => {
    if (scrollRef.current && !userScrolledUp.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    if (file.size > 5 * 1024 * 1024) return; // 5MB max
    if (pendingImage) URL.revokeObjectURL(pendingImage.preview);
    setPendingImage({ file, preview: URL.createObjectURL(file) });
    if (imageInputRef.current) imageInputRef.current.value = "";
  };

  const removePendingImage = () => {
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.preview);
      setPendingImage(null);
    }
  };

  const handleSubmit = async (text: string) => {
    if ((!text.trim() && !pendingImage) || isLoading) return;

    const parts: Array<
      | { type: "text"; text: string }
      | { type: "file"; url: string; mediaType: string }
    > = [];

    if (pendingImage) {
      const { dataUrl, mediaType } = await compressImageToDataUrl(pendingImage.file);
      parts.push({
        type: "file",
        url: dataUrl,
        mediaType,
      });
      removePendingImage();
    }

    if (text.trim()) {
      parts.push({ type: "text", text: text.trim() });
    }

    sendMessage({ parts });
    setInput("");
    userScrolledUp.current = false;
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  return (
    <div className="flex flex-1 min-h-0 flex-col">
      {header && (
        <div className="flex items-center justify-between border-b border-card-border px-4 py-3">
          <h2 className="font-semibold text-sm">{header}</h2>
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => {
                clearConversation(conversationId);
                setMessages([]);
              }}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              New chat
            </button>
          )}
        </div>
      )}
      {/* Messages */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="min-h-0 flex-1 overflow-y-auto space-y-4 p-4 thin-scrollbar"
        role="log"
        aria-live="polite"
        aria-label="Chat messages"
      >
        {messages.length === 0 && activeSuggestions && (
          <div className="space-y-2">
            <p className="text-sm text-muted">Try asking:</p>
            {activeSuggestions.map((q) => (
              <button
                key={q}
                onClick={() => handleSubmit(q)}
                aria-label={`Ask: ${q}`}
                className="block w-full rounded-lg border border-card-border px-3 py-2.5 text-left text-sm hover:bg-muted-bg transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {messages.map((m) => (
          <div
            key={m.id}
            className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div
              className={`max-w-[85%] break-words rounded-xl px-4 py-2.5 text-sm ${
                m.role === "user"
                  ? "bg-accent-blue text-white"
                  : "bg-accent-teal/10 text-foreground"
              }`}
            >
              {m.role === "user" ? (
                m.parts.map((part, i) => {
                  if (part.type === "text") {
                    return <span key={i}>{part.text}</span>;
                  }
                  if (
                    part.type === "file" &&
                    typeof part.mediaType === "string" &&
                    part.mediaType.startsWith("image/")
                  ) {
                    return (
                      <img
                        key={i}
                        src={part.url}
                        alt="User uploaded image"
                        className="max-h-48 rounded-lg mb-1"
                      />
                    );
                  }
                  return null;
                })
              ) : (
                <>
                  {m.parts.some(
                    (p) => p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/")
                  ) &&
                    m.parts
                      .filter((p) => p.type === "file" && typeof p.mediaType === "string" && p.mediaType.startsWith("image/"))
                      .map((p, i) => (
                        <img key={`img-${i}`} src={(p as { url: string }).url} alt="Generated image" className="max-h-80 rounded-lg mb-1" />
                      ))}
                  {imageGenStatus && m === messages[messages.length - 1] && (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted">
                      <span className="inline-flex gap-1">
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "0ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "150ms" }} />
                        <span className="h-1.5 w-1.5 rounded-full bg-current animate-bounce" style={{ animationDelay: "300ms" }} />
                      </span>
                      {imageGenStatus === "infographic" ? "Generating infographic..." : "Generating image..."}
                    </div>
                  )}
                  <div className="chat-markdown">
                    <Markdown remarkPlugins={[remarkGfm]}>
                      {normalizeMarkdown(
                        m.parts
                          .filter((p) => p.type === "text")
                          .map((p) => (p as { text: string }).text)
                          .join("\n\n")
                      )}
                    </Markdown>
                  </div>
                </>
              )}
            </div>
          </div>
        ))}

        {isLoading && messages[messages.length - 1]?.role !== "assistant" && (
          <div className="flex justify-start">
            <div className="text-sm text-muted">Thinking...</div>
          </div>
        )}

        {error && (
          <div className="rounded-lg border border-danger/20 bg-danger/5 p-3 text-sm text-danger">
            Something went wrong: {error.message || "Unknown error"}
          </div>
        )}

        {/* Dynamic follow-up suggestions after conversation */}
        {!isLoading && messages.length > 0 && dynamicSuggestions && (
          <div className="flex flex-wrap gap-2">
            {dynamicSuggestions.map((q) => (
              <button
                key={q}
                onClick={() => handleSubmit(q)}
                className="rounded-full border border-card-border px-3 py-1.5 text-xs text-muted hover:bg-muted-bg hover:text-foreground transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
              >
                {q}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit(input);
        }}
        className="border-t border-card-border p-3"
      >
        {/* Pending image preview */}
        {pendingImage && (
          <div className="mb-2 flex items-start gap-2">
            <div className="relative h-16 w-16 flex-shrink-0">
              <img
                src={pendingImage.preview}
                alt="Pending upload"
                className="h-full w-full rounded-lg border border-card-border object-cover"
              />
              <button
                type="button"
                onClick={removePendingImage}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-danger text-white text-xs"
                aria-label="Remove image"
              >
                &times;
              </button>
            </div>
            <p className="text-xs text-muted pt-1">Image attached</p>
          </div>
        )}

        <input
          ref={imageInputRef}
          type="file"
          accept="image/*"
          onChange={handleImageSelect}
          className="hidden"
        />

        <div className="flex gap-2">
          {/* Camera button */}
          <button
            type="button"
            onClick={() => imageInputRef.current?.click()}
            disabled={isLoading || !!pendingImage}
            className="rounded-lg border border-card-border bg-card-bg px-3 py-2 text-muted transition-colors hover:bg-muted-bg hover:text-foreground disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary"
            aria-label="Attach photo"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>

          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={isLoading ? "Waiting for response..." : "Ask a question..."}
            className="flex-1 rounded-lg border border-card-border bg-card-bg px-3 py-2 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {isLoading ? (
            <button
              type="button"
              onClick={stop}
              className="rounded-lg border border-card-border bg-card-bg px-4 py-2 text-sm font-medium transition-colors hover:bg-muted-bg focus:outline-none focus:ring-2 focus:ring-primary"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim() && !pendingImage}
              className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
