"use client";

import { Suspense, lazy, useMemo, type ReactNode } from "react";
import type { UIMessage } from "ai";
import { Message, MessageContent } from "../ai-elements/message";
import { Tool, ToolHeader } from "../ai-elements/tool";
import { Source, Sources, SourcesContent, SourcesTrigger } from "../ai-elements/sources";
import { IntakeTableCard } from "../IntakeTableCard";
import { ImportCard } from "../ImportCard";
import { ChatProposalCards, type ChatProposalItem } from "../ChatProposalCards";
import type { IntakeTablePayload } from "../../lib/intake/types";
import type { ImportCardPayload } from "../../lib/import/view";
import { citedPassages, manualPassages } from "./manual-citations";
import { stripCitations, toolStatusLabel, type ChatT } from "./chat-text";

type Part = UIMessage["parts"][number];

/**
 * The assistant's prose is drawn by streamdown (`ChatResponse`), about 300 KB
 * of script. The chat is mounted in the root layout, so it is imported only
 * when needed: `preloadChatResponse()` starts the download when the sheet
 * opens, and until it lands an answer shows as plain text.
 */
const loadChatResponse = () => import("./ChatResponse");
const ChatResponse = lazy(() => loadChatResponse().then((module) => ({ default: module.ChatResponse })));

export function preloadChatResponse(): void {
  void loadChatResponse();
}

const RUNNING = new Set(["input-streaming", "input-available"]);

/**
 * One turn of the conversation (UI system phase 5b; DESIGN.md §8.11), its
 * parts in the order they streamed:
 *
 * - **text** — the user's words in a square block; the assistant's as prose
 *   (`ChatResponse`: streamdown, manual citations inline);
 * - **a tool call still running** — one `Tool` status line with a spinner
 *   ("📖 Searching the Form 4 manual…"); a finished call draws nothing;
 * - **cards**, full width — the intake table (`data-intake-table`, written by
 *   `identify_tools`), the assistant's proposals (`data-proposal`, all of a
 *   turn's in one `ChatProposalCards` where the first arrived) and an
 *   import's hand-off (`data-import-card`);
 * - then, for an answer that cited the manual, its **Sources**: the pages it
 *   linked, each opening the PDF there.
 *
 * A turn with nothing to show yet renders nothing; the chat's loader covers it.
 */
export function ChatMessage({
  message,
  t,
  onInternalNavigate,
}: {
  message: UIMessage;
  t: ChatT;
  onInternalNavigate: () => void;
}) {
  const passages = useMemo(() => manualPassages(message.parts), [message.parts]);
  const citationLabel = useMemo(() => (citation: string) => t("citationAria", { citation }), [t]);

  const proposals = message.parts
    .filter((p): p is Part & { data: ChatProposalItem } => p.type === "data-proposal" && isKind(p, "proposal"))
    .map((p) => p.data);
  const assistantText = message.role === "assistant" ? textOf(message.parts) : "";
  const cited = citedPassages(assistantText, passages);

  const blocks: ReactNode[] = [];
  let hasCard = false;
  let proposalsPlaced = false;
  message.parts.forEach((part, index) => {
    if (part.type === "text") {
      if (!part.text.trim()) return;
      blocks.push(
        message.role === "assistant" ? (
          <Suspense key={index} fallback={<p className="text-sm whitespace-pre-wrap">{stripCitations(part.text)}</p>}>
            <ChatResponse
              text={part.text}
              passages={passages}
              onInternalNavigate={onInternalNavigate}
              citationLabel={citationLabel}
            />
          </Suspense>
        ) : (
          <p key={index}>{part.text}</p>
        )
      );
      return;
    }
    if (part.type.startsWith("tool-") && RUNNING.has((part as { state?: string }).state ?? "")) {
      blocks.push(
        <Tool key={index} aria-label={t("toolRunningAria")}>
          <ToolHeader
            title={toolStatusLabel(part.type, t, (part as { input?: unknown }).input)}
            state={(part as { state: "input-available" }).state}
          />
        </Tool>
      );
      return;
    }
    if (part.type === "data-intake-table" && isKind(part, "intake-table")) {
      hasCard = true;
      const data = (part as { data: IntakeTablePayload }).data;
      blocks.push(<IntakeTableCard key={`intake-${data.batchId}`} payload={data} />);
      return;
    }
    if (part.type === "data-proposal" && isKind(part, "proposal")) {
      hasCard = true;
      if (!proposalsPlaced) {
        proposalsPlaced = true;
        blocks.push(<ChatProposalCards key={`proposals-${index}`} items={proposals} />);
      }
      return;
    }
    if (part.type === "data-import-card" && isKind(part, "import-card")) {
      hasCard = true;
      const data = (part as { data: ImportCardPayload }).data;
      blocks.push(<ImportCard key={`import-${data.import.id}`} payload={data} />);
    }
  });

  if (blocks.length === 0) return null;

  return (
    <Message from={message.role} hasCard={hasCard}>
      <MessageContent>
        {blocks}
        {cited.length > 0 ? (
          <Sources>
            <SourcesTrigger>{t("sourcesCount", { count: cited.length })}</SourcesTrigger>
            <SourcesContent>
              {cited.map((passage) => (
                <Source key={passage.url} href={passage.url} title={passage.citation} />
              ))}
            </SourcesContent>
          </Sources>
        ) : null}
      </MessageContent>
    </Message>
  );
}

function isKind(part: Part, kind: string): boolean {
  return (part as { data?: { kind?: unknown } }).data?.kind === kind;
}

function textOf(parts: readonly Part[]): string {
  return parts.map((p) => (p.type === "text" ? p.text : "")).join("\n");
}
