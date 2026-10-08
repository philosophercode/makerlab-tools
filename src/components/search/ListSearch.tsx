"use client";

import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { useChatLauncher } from "../ChatLauncherContext";

/**
 * The tool list's part of the search (student home spec 2026-10-07 §5): the
 * list once had its own box here, which went when the list became the home
 * page (amendment "One page: the list at rest") and the page's one box
 * (`home/HomeSearch`) took over. What stays is the Ask row the results end
 * with.
 */

/**
 * "Ask MakerLAB AI: “…”" after the home page's results, and in their place
 * when nothing matches: a button, so the question goes to the model only when
 * somebody presses it. It opens the chat with the text as the first message.
 */
export function AskMakerlabRow({ query }: { query: string }) {
  const t = useTranslations("gallery.search");
  const { open } = useChatLauncher();
  const question = query.trim();
  if (!question) return null;
  return (
    <button
      type="button"
      data-slot="ask-makerlab-row"
      onClick={() => open(question)}
      className="mb-3 flex w-full cursor-pointer items-start gap-3 border border-border bg-card p-2 text-start transition-colors duration-150 hover:border-primary-ink/60 hover:bg-accent"
    >
      <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center bg-primary text-primary-foreground">
        <MessageSquare className="size-4" />
      </span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm break-words text-foreground">{t("ask", { query: question })}</span>
        <span className="text-xs text-muted-foreground">{t("askNote")}</span>
      </span>
    </button>
  );
}
