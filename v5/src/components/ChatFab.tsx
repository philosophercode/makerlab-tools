"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";

interface ChatFabProps {
  contextLabel?: string;
}

export function ChatFab({ contextLabel = "Gallery" }: ChatFabProps) {
  const [isOpen, setIsOpen] = useState(false);
  const pathname = usePathname();
  const routeContext = pathname.startsWith("/tools/")
    ? `Tool detail: ${pathname.split("/").filter(Boolean).at(-1)}`
    : contextLabel;

  return (
    <>
      <button
        className="chat-fab"
        type="button"
        aria-expanded={isOpen}
        aria-controls="makerlab-chat-sheet"
        aria-label="Open MakerLab chat"
        onClick={() => setIsOpen(true)}
      >
        &gt;_
      </button>

      {isOpen ? (
        <div className="chat-overlay" role="dialog" aria-modal="true" aria-labelledby="chat-title">
          <button
            className="chat-scrim"
            type="button"
            aria-label="Close MakerLab chat"
            onClick={() => setIsOpen(false)}
          />
          <section className="chat-sheet" id="makerlab-chat-sheet">
            <div className="chat-header">
              <div>
                <p className="eyebrow">READ-ONLY ASSISTANT</p>
                <h2 id="chat-title">MakerLab Console</h2>
              </div>
              <button type="button" onClick={() => setIsOpen(false)} aria-label="Close chat">
                [X]
              </button>
            </div>

            <div className="chat-body">
              <article className="chat-message system">
                Context loaded: {routeContext}. Catalog search and tool detail retrieval are
                prepared for integration.
              </article>
              <article className="chat-message">
                Ask about tool availability, training requirements, safe materials, or where to
                find a machine in the lab.
              </article>
            </div>

            <form className="chat-composer">
              <label htmlFor="chat-input">&gt;</label>
              <input id="chat-input" placeholder="ask the lab console..." />
              <button type="submit">SEND</button>
            </form>
          </section>
        </div>
      ) : null}
    </>
  );
}
