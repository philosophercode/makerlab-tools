"use client";

import { useMemo, type ReactNode } from "react";
import Link from "next/link";
import type { Components } from "streamdown";
import { MessageResponse } from "../ai-elements/message";
import {
  InlineCitation,
  InlineCitationCard,
  InlineCitationCardBody,
  InlineCitationCardTrigger,
  InlineCitationQuote,
  InlineCitationSource,
  InlineCitationText,
} from "../ai-elements/inline-citation";
import { citationPhrase, pageMark, type ManualPassageRef } from "./manual-citations";
import { stripCitations } from "./chat-text";

/**
 * One piece of the assistant's prose (UI system phase 5b): streamdown through
 * `MessageResponse`, with the chat's three kinds of link.
 *
 * - **A manual citation** — an address one of this message's `search_manual`
 *   passages returned — is an `InlineCitation`: the linked words (less the
 *   "(Form 4 Manual, p. 42)" the prompt has the model repeat in them, which
 *   the mark now says), then a mono `P. 42` mark that opens the manual at the
 *   page, with a card (hover or focus) naming the manual, the section and the
 *   passage's words.
 * - **A link into the site** (`/tools/form-4`) is a client-side `Link` that
 *   also closes the sheet, so the page it names is what the reader sees.
 * - **Anything else** opens in a new tab.
 */
export function ChatResponse({
  text,
  passages,
  onInternalNavigate,
  citationLabel,
}: {
  text: string;
  passages: ReadonlyMap<string, ManualPassageRef>;
  onInternalNavigate: () => void;
  /** The mark's accessible name: "Open Form 4 Manual, p. 42". */
  citationLabel: (citation: string) => string;
}) {
  const components = useMemo<Components>(
    () => ({
      a({ href, children }) {
        const target = typeof href === "string" ? href : "";
        const passage = passages.get(target.trim());
        if (passage) {
          return <Citation passage={passage} label={citationLabel(passage.citation)}>{children}</Citation>;
        }
        if (target.startsWith("/") && !target.startsWith("//")) {
          return (
            <Link href={target} onClick={onInternalNavigate}>
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
    [passages, onInternalNavigate, citationLabel]
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
