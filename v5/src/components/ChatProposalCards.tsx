"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { isAcceptable, type FieldProposal } from "../lib/refresh/types";
import { ProposalCard } from "./admin/ProposalCard";
import { Button } from "@/components/ui/button";
import { ReviewNote } from "./system/review/ReviewCard";

/**
 * The assistant's proposals in the chat (refresh research spec §12.2): one
 * `data-proposal` card each — field, current → proposed, the quote and link, a
 * "quote not found" warning — with **Accept** / **Reject**, and **Accept all
 * verified** when a turn brought several.
 *
 * The buttons call `POST /api/chat-proposals`, never the model: only the
 * admin's click accepts. The route answers each card's new state — accepted,
 * rejected, or a conflict showing the record's value now — and the page behind
 * the chat is re-rendered so an accepted change shows there too.
 */

export interface ChatProposalItem {
  kind: "proposal";
  proposalId: string;
  subject: { kind: "tool" | "pending"; id: string; name: string };
  proposal: FieldProposal;
}

type Outcome =
  | { id: string; status: "accepted" | "rejected" | "conflict"; proposal: FieldProposal; warning?: string }
  | { id: string; status: "refused"; error: string };

export function ChatProposalCards({ items }: { items: ChatProposalItem[] }) {
  const t = useTranslations("chat");
  const te = useTranslations("admin.errors");
  const router = useRouter();
  const [proposals, setProposals] = useState<Record<string, FieldProposal>>(() =>
    Object.fromEntries(items.map((item) => [item.proposalId, item.proposal]))
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = (item: ChatProposalItem) => proposals[item.proposalId] ?? item.proposal;
  const acceptable = items.filter((item) => isAcceptable(current(item)));

  async function decide(ids: string[], decision: "accept" | "reject") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/chat-proposals", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ids, decision }),
      });
      const body = (await res.json().catch(() => null)) as { results?: Outcome[]; code?: string } | null;
      if (!res.ok || !body?.results) {
        setError(t("proposalFailed", { reason: te(res.status === 403 ? "not_permitted" : "failed") }));
        return;
      }
      const next: Record<string, FieldProposal> = {};
      for (const outcome of body.results) {
        if (outcome.status === "refused") setError(t("proposalFailed", { reason: te(knownError(outcome.error)) }));
        else next[outcome.id] = outcome.proposal;
      }
      setProposals((prev) => ({ ...prev, ...next }));
      if (body.results.some((outcome) => outcome.status === "accepted")) router.refresh();
    } catch {
      setError(t("proposalFailed", { reason: te("failed") }));
    } finally {
      setBusy(false);
    }
  }

  return (
    // The cards are ReviewCards (via ProposalCard), full width in the message
    // (DESIGN.md §8.11); Accept all verified is the one filled button.
    <div className="ui flex flex-col gap-2 border-t border-rule">
      {items.map((item) => (
        <ProposalCard
          key={item.proposalId}
          proposal={current(item)}
          busy={busy}
          onAccept={() => void decide([item.proposalId], "accept")}
          onReject={() => void decide([item.proposalId], "reject")}
        />
      ))}
      {acceptable.length > 1 ? (
        <Button
          variant="default"
          size="sm"
          className="self-start"
          disabled={busy}
          onClick={() => void decide(acceptable.map((item) => item.proposalId), "accept")}
        >
          {t("proposalsAcceptAll")}
        </Button>
      ) : null}
      {error ? (
        <ReviewNote tone="bad" role="alert">
          {error}
        </ReviewNote>
      ) : null}
    </div>
  );
}

const KNOWN_ERRORS = new Set([
  "not_found",
  "not_permitted",
  "not_editable",
  "expired",
  "conflict",
  "invalid_field",
  "unverified_quote",
  "replaces_lab_rule",
  "failed",
]);

function knownError(code: string): string {
  return KNOWN_ERRORS.has(code) ? code : "failed";
}
