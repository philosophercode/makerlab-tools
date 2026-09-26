import type { useTranslations } from "next-intl";

/**
 * The chat's words about itself — what a running tool is doing, whether an
 * error is the allowance ceiling, and the citation markup the model may leave
 * in its prose. Pure, so `ChatMessage` and the tests share one reading.
 */

export type ChatT = ReturnType<typeof useTranslations<"chat">>;

/** The status line for a tool call in flight ("📖 Searching the Form 4 manual…"). */
export function toolStatusLabel(partType: string, t: ChatT, input?: unknown): string {
  if (partType === "tool-search_manual") {
    // The machine the model named, when it named one; on a tool's page it
    // usually does not (that tool is preset), and the line stays generic.
    const tool = (input as { tool?: unknown } | undefined)?.tool;
    return typeof tool === "string" && tool.trim()
      ? t("searchingManual", { tool: tool.trim().slice(0, 60) })
      : t("searchingManuals");
  }
  if (partType === "tool-get_unit_details") return t("lookingUpUnit");
  if (partType === "tool-report_issue") return t("filingTicket");
  if (partType === "tool-identify_tools") return t("identifyingEquipment");
  if (partType === "tool-start_import") return t("startingImport");
  // Web search runs inside the Gateway, but its call still streams as a tool part.
  if (partType === "tool-exa_search") return t("searchingWeb");
  if (partType === "tool-read_page") return t("readingPage");
  if (partType === "tool-get_record") return t("readingRecord");
  if (partType === "tool-propose_change") return t("proposingChange");
  return t("working");
}

/**
 * The two ways `/api/chat` refuses at the allowance ceiling: an anonymous
 * visitor who can sign in to continue, and a signed-in caller who can only wait.
 */
export type Ceiling = "sign-in" | "wait";

/**
 * Recognize the rate-limit ceiling in a chat error.
 *
 * `useChat` surfaces a non-OK response as an `Error` whose message is the raw
 * response body, so the refusal arrives here as JSON text. It matters that we
 * unpack it: hitting the ceiling is a normal thing that happens to a visitor
 * mid-conversation, and it renders as an assistant message offering a way
 * forward — never as an error row and never as a toast (design spec §6).
 *
 * Matching is on `code`, not on the English `error` text, because the copy the
 * user reads comes from `messages/*.json` (Article 6).
 */
export function parseCeiling(error: Error | undefined): Ceiling | null {
  const raw = error?.message?.trim();
  if (!raw || !raw.startsWith("{")) return null;
  try {
    const body = JSON.parse(raw) as { code?: string };
    if (body.code === "rate_limited_sign_in") return "sign-in";
    if (body.code === "rate_limited") return "wait";
  } catch {
    // Not JSON — an ordinary streaming error. Falls through to the error row.
  }
  return null;
}

/**
 * The assistant can wrap grounded text in inline source markup such as
 * `<cite index="1-9">…</cite>`. The chat renders Markdown with raw HTML off,
 * so the tags are removed here and the cited prose kept.
 */
export function stripCitations(text: string): string {
  return text.replace(/<cite\b[^>]*>/gi, "").replace(/<\/cite>/gi, "");
}
