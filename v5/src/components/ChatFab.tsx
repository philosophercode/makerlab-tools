"use client";

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

interface Suggestion {
  icon: "search" | "clipboard" | "pin";
  label: string;
}

const SUGGESTIONS: Suggestion[] = [
  { icon: "search", label: "Find a machine for a project" },
  { icon: "clipboard", label: "Check training requirements" },
  { icon: "pin", label: "Ask about safety or policy" },
];

function Icon({ name }: { name: Suggestion["icon"] | "send" | "close" }) {
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
  }
}

export function ChatFab() {
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const pathname = usePathname() || "/";
  const toolId = useMemo(() => {
    const match = pathname.match(/^\/tools\/(.+)$/);
    return match ? match[1] : undefined;
  }, [pathname]);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/chat",
        prepareSendMessagesRequest: ({ id, messages, trigger, messageId }) => ({
          body: {
            id,
            messages,
            trigger,
            messageId,
            ...(toolId ? { toolId } : {}),
          },
        }),
      }),
    [toolId]
  );

  const { messages, sendMessage, status, error } = useChat({ transport });
  const isLoading = status === "streaming" || status === "submitted";

  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  function close() {
    setIsOpen(false);
  }

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
    []
  );

  function handleSuggestion(label: string) {
    if (isLoading) return;
    sendMessage({ text: label });
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const text = draft.trim();
    if (!text || isLoading) return;
    sendMessage({ text });
    setDraft("");
  }

  return (
    <>
      <button
        className="chat-fab"
        type="button"
        aria-expanded={isOpen}
        aria-controls="makerlab-chat-sheet"
        aria-label="Open MakerLab assistant"
        onClick={() => setIsOpen(true)}
      >
        &gt;_
      </button>

      {isOpen ? (
        <div className="chat-overlay" role="dialog" aria-modal="true" aria-labelledby="chat-title">
          <button
            className="chat-scrim"
            type="button"
            aria-label="Close MakerLab assistant"
            onClick={close}
          />
          <section className="chat-sheet" id="makerlab-chat-sheet">
            <header className="chat-header">
              <h2 id="chat-title">MAKERLAB ASSISTANT</h2>
              <button
                type="button"
                className="chat-close"
                onClick={close}
                aria-label="Close assistant"
              >
                <Icon name="close" />
              </button>
            </header>

            <div className="chat-body" ref={scrollRef}>
              {messages.length === 0 ? (
                <>
                  <p className="chat-greeting">How can I help you today?</p>
                  <div className="chat-suggestions">
                    {SUGGESTIONS.map((suggestion) => (
                      <button
                        key={suggestion.label}
                        type="button"
                        className="chat-suggestion"
                        onClick={() => handleSuggestion(suggestion.label)}
                        disabled={isLoading}
                      >
                        <span className="chat-suggestion-icon" aria-hidden="true">
                          <Icon name={suggestion.icon} />
                        </span>
                        <span>{suggestion.label}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <ul className="chat-messages">
                  {messages.map((message) => (
                    <li key={message.id} className={`chat-msg chat-msg-${message.role}`}>
                      {message.parts.map((part, index) => {
                        if (part.type !== "text") return null;
                        if (message.role === "assistant") {
                          return (
                            <div key={index} className="chat-markdown">
                              <ReactMarkdown
                                remarkPlugins={[remarkGfm]}
                                components={markdownComponents}
                              >
                                {part.text}
                              </ReactMarkdown>
                            </div>
                          );
                        }
                        return <p key={index}>{part.text}</p>;
                      })}
                    </li>
                  ))}
                  {isLoading && messages[messages.length - 1]?.role !== "assistant" ? (
                    <li className="chat-msg chat-msg-assistant">
                      <p className="chat-typing" aria-label="Assistant is typing">
                        <span />
                        <span />
                        <span />
                      </p>
                    </li>
                  ) : null}
                  {error ? (
                    <li className="chat-msg chat-msg-error">
                      <p>Something went wrong. Try again.</p>
                    </li>
                  ) : null}
                </ul>
              )}
            </div>

            <form className="chat-composer" onSubmit={handleSubmit}>
              <input
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Ask the lab console..."
                aria-label="Ask the lab console"
                disabled={isLoading}
              />
              <button
                type="submit"
                className="chat-send"
                aria-label="Send"
                disabled={!draft.trim() || isLoading}
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
