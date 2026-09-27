"use client";

import { useEffect } from "react";
import { useChatLauncher } from "./ChatLauncherContext";

/**
 * Hands a tool page's starter questions to the assistant (spec amendment
 * "Tool-specific starter questions"). Renders nothing: it registers the
 * questions with the chat launcher while the page is mounted and takes them
 * back when it goes, so `ChatFab` — which lives in the layout and knows only
 * the path — can offer them as its chips on this page and the generic ones
 * everywhere else.
 *
 * A tool with no questions registers nothing, which is the generic chips.
 */
export function ToolChatStarters({
  slug,
  id,
  questions,
}: {
  slug: string;
  id: string;
  questions: readonly string[];
}) {
  const { setToolStarters } = useChatLauncher();
  // A stable dependency for the effect: the array itself is a new object on every render.
  const joined = questions.join("\n");

  useEffect(() => {
    const list = joined ? joined.split("\n") : [];
    if (list.length === 0) return;
    setToolStarters({ keys: [slug, id], questions: list });
    return () => setToolStarters(null);
  }, [slug, id, joined, setToolStarters]);

  return null;
}
