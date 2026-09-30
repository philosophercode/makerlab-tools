import { useTranslations } from "next-intl";
import { MCP_AUDIENCES, type McpToolSummary } from "../../lib/capabilities/mcp-catalog";
import type { Role } from "../../lib/auth/roles";
import { Badge } from "@/components/ui/badge";
import { PageSection, SectionLabel } from "../system/PublicPage";
import { Glyph } from "../system/StatusGlyph";

/**
 * The tools on `/mcp` (MCP access spec, amendment 2026-09-25), grouped by who
 * is offered them. The list is `describeMcpTools(CAPABILITIES)` — the registry
 * itself — so nothing here names a tool. `usable` holds the tools the viewer's
 * own role would be offered, marked "You can use this" (◆, the accent: it is
 * the viewer's).
 *
 * Phase 5a: a hairline-ruled list instead of a boxed card per tool — one line
 * for name, kind and mark, the description under it, inputs behind a
 * disclosure. Presentational; no state.
 */
export function McpToolList({
  tools,
  usable,
  viewerRole,
}: {
  tools: McpToolSummary[];
  usable: ReadonlySet<string>;
  viewerRole: Role;
}) {
  const t = useTranslations("mcpPage");
  return (
    <PageSection id="mcp-tools-heading" title={t("toolsHeading")} lede={t("toolsLede")}>
      <p className="border-s-2 border-s-primary-ink ps-3 text-sm">{t("viewerNote", { role: viewerRole })}</p>
      {MCP_AUDIENCES.map((audience) => {
        const group = tools.filter((tool) => tool.audience === audience);
        if (group.length === 0) return null;
        const headingId = `mcp-audience-${audience}`;
        return (
          <section key={audience} aria-labelledby={headingId} className="flex min-w-0 flex-col gap-1">
            <SectionLabel id={headingId}>{t(`audience.${audience}`)}</SectionLabel>
            <p className="text-xs text-muted-foreground">{t(`audience.${audience}Body`)}</p>
            <ul className="m-0 mt-1 list-none border-t border-rule p-0">
              {group.map((tool) => (
                <McpToolItem key={tool.name} tool={tool} usable={usable.has(tool.name)} />
              ))}
            </ul>
          </section>
        );
      })}
    </PageSection>
  );
}

function McpToolItem({ tool, usable }: { tool: McpToolSummary; usable: boolean }) {
  const t = useTranslations("mcpPage");
  return (
    <li aria-label={tool.name} className="flex min-w-0 flex-col gap-1 border-b border-rule py-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <code className="font-mono text-sm font-bold break-all">{tool.name}</code>
        <Badge className={tool.kind === "write" ? "border-bad/70 text-bad" : undefined}>{t(`kind.${tool.kind}`)}</Badge>
        {usable ? (
          <span className="inline-flex items-baseline gap-1.5 font-mono text-label text-primary-ink uppercase">
            <Glyph tone="active" />
            {t("youCanUse")}
          </span>
        ) : null}
      </div>
      <p className="max-w-[80ch] text-table text-muted-foreground">{tool.description}</p>
      {tool.fields.length === 0 ? (
        <p className="font-mono text-micro text-muted-foreground uppercase">{t("noInputs")}</p>
      ) : (
        <details className="text-table">
          <summary className="cursor-pointer font-mono text-label uppercase">{t("inputs", { count: tool.fields.length })}</summary>
          <ul className="mt-1 flex list-none flex-col gap-1 ps-4">
            {tool.fields.map((field) => (
              <li key={field.name}>
                <code className="font-mono">{field.name}</code>{" "}
                <span className="text-muted-foreground">
                  {field.enumValues ? field.enumValues.join(" | ") : field.type} ·{" "}
                  {field.required ? t("required") : t("optional")}
                </span>
                {field.description ? <span className="text-muted-foreground"> — {field.description}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
