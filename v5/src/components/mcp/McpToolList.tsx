import { useTranslations } from "next-intl";
import { MCP_AUDIENCES, type McpToolSummary } from "../../lib/capabilities/mcp-catalog";
import type { Role } from "../../lib/auth/roles";

/**
 * The tools on `/mcp` (MCP access spec, amendment 2026-09-25), grouped by who
 * is offered them. The list is `describeMcpTools(CAPABILITIES)` — the registry
 * itself — so nothing here names a tool. `usable` holds the tools the viewer's
 * own role would be offered, marked "You can use this".
 *
 * Presentational; no state.
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
    <section className="account-section" aria-labelledby="mcp-tools-heading">
      <h2 id="mcp-tools-heading">{t("toolsHeading")}</h2>
      <p>{t("toolsLede")}</p>
      <p className="mcp-viewer-note">{t("viewerNote", { role: viewerRole })}</p>
      {MCP_AUDIENCES.map((audience) => {
        const group = tools.filter((tool) => tool.audience === audience);
        if (group.length === 0) return null;
        const headingId = `mcp-audience-${audience}`;
        return (
          <section key={audience} className="mcp-audience" aria-labelledby={headingId}>
            <h3 id={headingId}>{t(`audience.${audience}`)}</h3>
            <p className="account-field-hint">{t(`audience.${audience}Body`)}</p>
            <ul className="mcp-tool-list">
              {group.map((tool) => (
                <McpToolItem key={tool.name} tool={tool} usable={usable.has(tool.name)} />
              ))}
            </ul>
          </section>
        );
      })}
    </section>
  );
}

function McpToolItem({ tool, usable }: { tool: McpToolSummary; usable: boolean }) {
  const t = useTranslations("mcpPage");
  return (
    <li className="mcp-tool" aria-label={tool.name}>
      <div className="mcp-tool-head">
        <code className="mcp-tool-name">{tool.name}</code>
        <span className={`account-tag mcp-kind is-${tool.kind}`}>{t(`kind.${tool.kind}`)}</span>
        {usable ? <span className="mcp-usable">{t("youCanUse")}</span> : null}
      </div>
      <p className="mcp-tool-description">{tool.description}</p>
      {tool.fields.length === 0 ? (
        <p className="account-field-hint">{t("noInputs")}</p>
      ) : (
        <details className="mcp-inputs">
          <summary>{t("inputs", { count: tool.fields.length })}</summary>
          <ul>
            {tool.fields.map((field) => (
              <li key={field.name}>
                <code>{field.name}</code>{" "}
                <span className="mcp-field-meta">
                  {field.enumValues ? field.enumValues.join(" | ") : field.type} ·{" "}
                  {field.required ? t("required") : t("optional")}
                </span>
                {field.description ? <span className="mcp-field-description"> — {field.description}</span> : null}
              </li>
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}
