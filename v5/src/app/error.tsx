"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/system/EmptyState";
import { PublicPage } from "../components/system/PublicPage";

/**
 * The app's error boundary (UI system phase 5a; DESIGN.md §8.9): say what
 * failed and that nothing was lost, offer Try again and the way home. The
 * catalogue fails toward stale, never toward invented data (Article 4); when
 * even that is impossible, this is what the visitor sees — in the system's
 * frame and words, not a stack trace.
 */
export default function RouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const t = useTranslations("errors");
  return (
    <PublicPage width="narrow" crumbs={[{ label: t("errorCrumb") }]} title={t("errorTitle")}>
      <EmptyState
        tone="bad"
        className="mt-4"
        action={
          <>
            <Button variant="default" onClick={() => reset()}>
              {t("tryAgain")}
            </Button>
            <Button asChild>
              <Link href="/">{t("browseTools")}</Link>
            </Button>
          </>
        }
      >
        {t("errorBody")}
      </EmptyState>
    </PublicPage>
  );
}
