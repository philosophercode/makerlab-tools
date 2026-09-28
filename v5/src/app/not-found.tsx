import Link from "next/link";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { EmptyState } from "../components/system/EmptyState";
import { PublicPage } from "../components/system/PublicPage";

/**
 * The app's 404 (UI system phase 5a; DESIGN.md §8.9): a page in the system's
 * frame, one sentence that says what is missing and the way back — never the
 * framework's bare default. A draft's slug gets this same page for anybody
 * who may not see drafts, so it reveals nothing (`DraftToolView`).
 */
export default function NotFound() {
  const t = useTranslations("errors");
  return (
    <PublicPage width="narrow" crumbs={[{ label: t("notFoundCrumb") }]} title={t("notFoundTitle")}>
      <EmptyState
        className="mt-4"
        action={
          <Button asChild variant="default">
            <Link href="/">{t("browseTools")}</Link>
          </Button>
        }
      >
        {t("notFoundBody")}
      </EmptyState>
    </PublicPage>
  );
}
