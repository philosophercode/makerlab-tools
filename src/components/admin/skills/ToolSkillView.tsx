import { useTranslations } from "next-intl";
import { sourcePages, type RemovedItem, type SkillSource } from "../../../lib/skills/format";
import { stripFrontmatter } from "../../../lib/skills/render";
import { Markdown } from "../../system/Markdown";

/**
 * A tool's current skill on its admin page (tool skills spec 2026-10-07 §6):
 * the rendered guide, the markdown as stored (for copying as a `SKILL.md`),
 * its sources, and what the checks removed. Presentational: the page reads
 * the row and hands the parts over. No client code.
 */
export interface ToolSkillViewProps {
  content: string;
  sources: readonly SkillSource[];
  removed: readonly RemovedItem[];
}

export function ToolSkillView({ content, sources, removed }: ToolSkillViewProps) {
  const t = useTranslations("admin.skills");
  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="tool-skill-heading" data-slot="tool-skill" className="flex min-w-0 flex-col gap-3">
        <h3 id="tool-skill-heading" className="m-0 font-heading text-lg font-medium uppercase">
          {t("skillHeading")}
        </h3>
        <Markdown className="max-w-[78ch] border border-border bg-card p-4">{stripFrontmatter(content)}</Markdown>
        <details className="max-w-[78ch] text-sm">
          <summary className="cursor-pointer text-muted-foreground">SKILL.md</summary>
          <pre className="mt-2 max-h-[28rem] overflow-auto border border-border bg-muted p-3 font-mono text-micro whitespace-pre-wrap">{content}</pre>
        </details>
      </section>

      {sources.length > 0 ? (
        <section aria-labelledby="tool-skill-sources-heading" data-slot="tool-skill-sources" className="flex flex-col gap-2">
          <div className="flex flex-col gap-1">
            <h3 id="tool-skill-sources-heading" className="m-0 font-heading text-lg font-medium uppercase">
              {t("sourcesHeading")}
            </h3>
            <p className="m-0 max-w-[78ch] text-sm text-muted-foreground">{t("sourcesLede")}</p>
          </div>
          <ul className="m-0 list-none border-t border-rule p-0 text-table">
            {sources.map((source) => (
              <li key={source.id} className="grid gap-x-4 gap-y-1 border-b border-rule py-2 sm:grid-cols-[4rem_9rem_minmax(0,1fr)]">
                <span className="font-mono text-micro">[{source.id}]</span>
                <span className="font-mono text-micro tracking-[0.08em] text-muted-foreground uppercase">{t(`sourceKind.${source.kind}`)}</span>
                <span className="min-w-0 break-words">{describe(source)}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {removed.length > 0 ? (
        <details data-slot="tool-skill-removed" className="max-w-[78ch] text-sm">
          <summary className="cursor-pointer">{t("removedHeading", { count: removed.length })}</summary>
          <p className="m-0 mt-2 text-muted-foreground">{t("removedLede")}</p>
          <ul className="m-0 mt-2 flex list-disc flex-col gap-1 ps-4">
            {removed.map((item, n) => (
              <li key={n}>
                <span className="font-mono text-micro text-muted-foreground uppercase">{t(`removedReason.${item.reason}`)}</span> {item.text}
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function describe(source: SkillSource) {
  switch (source.kind) {
    case "catalog":
      return source.toolName;
    case "lab_note":
      return source.text;
    case "manual":
      return `${source.title}, ${source.pageEnd > source.pageStart ? "pp." : "p."} ${sourcePages(source)}${source.section.length > 0 ? ` (${source.section.join(" › ")})` : ""}`;
    case "research":
      return (
        <span className="flex flex-col gap-0.5">
          {source.urls.map((url) => (
            <ExternalLink key={url} href={url} />
          ))}
        </span>
      );
    case "link":
      return (
        <span>
          {source.type ? `${source.type}: ` : ""}
          {source.url ? <ExternalLink href={source.url} label={source.title} /> : source.title}
        </span>
      );
  }
}

function ExternalLink({ href, label }: { href: string; label?: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary-ink hover:underline">
      {label ?? href}
    </a>
  );
}
