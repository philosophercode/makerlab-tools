"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { MessageSquare } from "lucide-react";
import { useChatLauncher } from "../ChatLauncherContext";
import { SEARCH_INPUT_CLASS, SearchFrame, useSearchLines } from "./SearchFrame";

/**
 * The full list's search (student home spec 2026-10-07 §5): the home page's
 * minimal box, filtering the list below it as you type. The matching tools
 * are the list itself, so there is no dropdown; asking MakerLAB AI is the
 * row under the box (`AskMakerlabRow`), never Enter.
 */
export function ListSearch({
  value,
  onChange,
  label,
  toolCount,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  toolCount: number;
}) {
  const id = useId();
  const lines = useSearchLines(toolCount);
  const [focused, setFocused] = useState(false);
  return (
    <>
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <SearchFrame lines={lines} empty={value === ""} focused={focused}>
        <input
          id={id}
          type="search"
          value={value}
          autoComplete="off"
          onChange={(event) => onChange(event.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          className={SEARCH_INPUT_CLASS}
          data-slot="list-search-input"
        />
      </SearchFrame>
    </>
  );
}

/**
 * "Ask MakerLAB AI: “…”" under the full list's search while it has text: a
 * button, so the question goes to the model only when somebody presses it.
 * It opens the chat with the text as the first message.
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
