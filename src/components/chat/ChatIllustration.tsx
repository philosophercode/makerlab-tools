"use client";

import { Sparkles } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { IllustrationPayload } from "../../lib/capabilities/illustrations";

/**
 * A generated illustration in the chat (`data-illustration`, written by
 * `make_illustration`; gateway spec amendment 2026-10-07): a sketch of a plan
 * or a concept render of a project idea, never a picture of the lab's
 * equipment.
 *
 * **Always labelled, twice.** A mark on the picture itself ("AI illustration")
 * — so a screenshot of it still says what it is — and the caption under it:
 * "AI-generated illustration, not a photo of our equipment. Check the manual
 * and staff for exact steps." Both come from the chat's own strings; nothing
 * the model wrote is drawn here.
 *
 * The image is our own route, which serves it only to the person who asked
 * for it (`/api/chat/illustrations/<id>`). Its URL comes from the payload the
 * server built, never from the model's text.
 */
export function ChatIllustration({ payload }: { payload: IllustrationPayload }) {
  const t = useTranslations("chat.illustration");
  const [failed, setFailed] = useState(false);
  const alt = payload.subject === "plan" ? t("altPlan") : t("altConcept");
  return (
    <figure data-kind="illustration" className="flex w-full flex-col gap-2 border border-border bg-card p-2">
      <div className="relative overflow-hidden border border-border bg-muted">
        {failed ? (
          <p className="flex aspect-square w-full items-center justify-center p-4 text-center text-xs text-muted-foreground">
            {t("unavailable")}
          </p>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- our own private route; next/image cannot forward the session
          <img
            src={payload.url}
            alt={alt}
            width={payload.width}
            height={payload.height}
            loading="lazy"
            decoding="async"
            className="block h-auto w-full"
            onError={() => setFailed(true)}
          />
        )}
        <span
          aria-hidden="true"
          className="absolute start-2 bottom-2 inline-flex items-center gap-1 border border-border bg-background/90 px-1.5 py-0.5 font-mono text-label tracking-[0.08em] text-foreground uppercase"
        >
          <Sparkles className="size-3" />
          {t("badge")}
        </span>
      </div>
      <figcaption className="text-xs text-muted-foreground">{t("caption")}</figcaption>
    </figure>
  );
}
