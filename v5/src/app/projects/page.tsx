import Link from "next/link";
import { useTranslations } from "next-intl";

export const metadata = {
  title: "Projects — MakerLab Tools v5",
};

export default function ProjectsPage() {
  const t = useTranslations("projects");

  return (
    <main className="tool-detail">
      <section className="td-panel td-coming-soon">
        <p className="td-eyebrow">{t("eyebrow")}</p>
        <h1>{t("title")}</h1>
        <p>{t("body")}</p>
        <Link className="td-button" href="/">
          {t("browseTools")}
        </Link>
      </section>
    </main>
  );
}
