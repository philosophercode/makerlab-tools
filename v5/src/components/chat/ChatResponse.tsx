"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { Components } from "streamdown";
import { MessageResponse } from "../ai-elements/message-response";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from "../ai-elements/inline-citation";
import { citationPhrase, classifyLink, documentPhrase, pageMark, type ManualPassageRef } from "./manual-citations";
import { stripCitations } from "./chat-text";

const NO_DOCUMENTS: ReadonlyMap<string, string> = new Map();

/**
 * One piece of the assistant's prose (UI system phase 5b): streamdown through
 * `MessageResponse`, with the chat's kinds of link (`classifyLink`).
 *
 * - **A manual citation** — a `#cite-<ref>` or an address one of this
 *   message's `search_manual` passages returned — is an `InlineCitation`: the
 *   linked words (less the "(Form 4 Manual, p. 42)" the prompt has the model
 *   repeat in them, which the mark now says), then a mono `P. 42` mark that
 *   opens the **tool's** URL for the page, with a card (hover or focus) naming
 *   the manual, the section and the passage's words.
 * - **An attached manual** (the route's `data-manual-links`) opens the stored
 *   document, without any page the model added.
 * - **A manual-looking address no tool returned** — a PDF, a `#page=` link, a
 *   Blob URL, an unknown ref — is drawn as its words, marked unverified, and is
 *   **not** a link (manual text spec amendment 2026-09-28).
 * - **A link into the site** (`/tools/form-4`) is a client-side `Link` that
 *   also closes the sheet, so the page it names is what the reader sees.
 * - **Anything else** opens in a new tab.
 */
export function ChatResponse({
  text,
  passages,
  documents = NO_DOCUMENTS,
  onInternalNavigate,
  citationLabel,
  unverifiedLabel,
}: {
  text: string;
  passages: ReadonlyMap<string, ManualPassageRef>;
  /** Attached manuals' stored addresses → titles. */
  documents?: ReadonlyMap<string, string>;
  onInternalNavigate: () => void;
  /** The mark's accessible name: "Open Form 4 Manual, p. 42". */
  citationLabel: (citation: string) => string;
  /** Said on a manual link the assistant wrote that no search returned. */
  unverifiedLabel: string;
}) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const link = classifyLink(typeof href === "string" ? href : "", passages, documents);
        switch (link.kind) {
          case "citation":
            return <Citation passage={link.passage} label={citationLabel(link.passage.citation)}>{children}</Citation>;
          case "internal":
            return (
              <Link href={link.href} onClick={onInternalNavigate}>
                {children}
              </Link>
            );
          case "document":
            return (
              <a href={link.url} target="_blank" rel="noopener noreferrer" title={link.title || undefined}>
                {typeof children === "string" && link.title ? documentPhrase(children, link.title) : children}
              </a>
            );
          case "unverified":
            return (
              <span data-slot="unverified-citation" title={unverifiedLabel}>
                {children}
              </span>
            );
          case "external":
            return (
              <a href={link.href} target="_blank" rel="noopener noreferrer">
                {children}
              </a>
            );
        }
      },
    }),
    [passages, documents, onInternalNavigate, citationLabel, unverifiedLabel]
  );

  return <MessageResponse components={components}>{stripCitations(text)}</MessageResponse>;
}

function Citation({ passage, label, children }: { passage: ManualPassageRef; label: string; children: ReactNode }) {
  return (
    <InlineCitation>
      <InlineCitationText>{typeof children === "string" ? citationPhrase(children, passage.citation) : children}</InlineCitationText>
      <InlineCitationCard>
        <InlineCitationCardTrigger href={passage.url} aria-label={label}>
          {pageMark(passage.citation)}
        </InlineCitationCardTrigger>
        <InlineCitationCardBody>
          <InlineCitationSource title={passage.citation} description={passage.section || undefined} />
          {passage.excerpt ? <InlineCitationQuote>{passage.excerpt}</InlineCitationQuote> : null}
        </InlineCitationCardBody>
      </InlineCitationCard>
    </InlineCitation>
  );
}
