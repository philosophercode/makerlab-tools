import { useTranslations } from "next-intl";
import {
  AREAS,
  PAGE_ROLES,
  type CapabilityItem,
  type ItemKind,
  type McpMode,
  type PageRole,
} from "../../lib/assistant/capabilities-page";
import { cn } from "@/lib/utils";
import { StatusGlyph } from "../system/StatusGlyph";

/**
 * The `/assistant` matrix: one row per thing MakerLAB AI can do, grouped by
 * area; one column per role for the chat, and one for an outside AI over MCP.
 * The viewer's own column is tinted and headed "You". Rows are the generated
 * data (`buildAssistantCapabilities`), so nothing here names a tool.
 *
 * One table with a `tbody` per area, so the columns line up down the page.
 * Below `sm` the role columns fold into one line under each label
 * (`PhoneStrip`); between `sm` and the column width it scrolls inside its box,
 * rather than widening the page. Presentational; no state.
 */
export function CapabilityMatrix({ items, viewerRole }: { items: CapabilityItem[]; viewerRole: PageRole }) {
  const t = useTranslations("assistantPage");
  const mine = (role: PageRole) => role === viewerRole;
  return (
    // `relative`: the compact glyphs' screen-reader words are `sr-only`
    // (absolute); without a positioned scroller they escape it and widen the page.
    <div className="relative -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" data-slot="capability-matrix">
      <table className="w-full border-collapse sm:min-w-[40rem] text-left text-table">
        <thead>
          <tr className="align-bottom">
            <th scope="col" className="sticky start-0 z-10 bg-background py-2 pe-3 font-mono text-label font-normal tracking-[0.08em] text-muted-foreground uppercase">
              {t("columnWhat")}
            </th>
            {PAGE_ROLES.map((role) => (
              <th
                key={role}
                scope="col"
                data-role={role}
                aria-current={mine(role) ? "true" : undefined}
                className={cn("hidden w-[5.5rem] px-1.5 py-2 text-center font-normal sm:table-cell", mine(role) && "bg-primary/10")}
              >
                {mine(role) ? <span className="block font-mono text-micro text-primary-ink uppercase">{t("you")}</span> : null}
                <span className="block text-sm font-medium">{t(`roles.${role}`)}</span>
                <span className="block text-micro text-muted-foreground">{t(`roles.${role}Body`)}</span>
              </th>
            ))}
            <th scope="col" className="hidden w-[8rem] border-s border-rule ps-3 py-2 text-start font-normal sm:table-cell">
              <span className="block text-sm font-medium">{t("roles.mcp")}</span>
              <span className="block text-micro text-muted-foreground">{t("roles.mcpBody")}</span>
            </th>
          </tr>
        </thead>
        {AREAS.map((area) => {
          const rows = items.filter((item) => item.area === area);
          if (rows.length === 0) return null;
          return (
            <tbody key={area} data-area={area}>
              <tr>
                <th
                  scope="colgroup"
                  colSpan={PAGE_ROLES.length + 2}
                  className="sticky start-0 bg-background pt-6 pb-1 font-heading text-sm font-medium tracking-[0.04em] uppercase"
                >
                  {t(`areas.${area}`)}
                </th>
              </tr>
              {rows.map((item) => (
                <CapabilityRow key={item.key} item={item} viewerRole={viewerRole} />
              ))}
            </tbody>
          );
        })}
      </table>
    </div>
  );
}

function CapabilityRow({ item, viewerRole }: { item: CapabilityItem; viewerRole: PageRole }) {
  const t = useTranslations("assistantPage");
  const label = t.has(item.labelKey) ? t(item.labelKey) : item.toolName;
  return (
    <tr data-item={item.key} data-kind={item.kind} className="border-t border-rule align-top">
      <th scope="row" className="sticky start-0 z-10 bg-background py-1.5 pe-3 font-normal">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className={cn(item.kind === "pageOnly" && "text-muted-foreground")}>{label}</span>
          <span className="font-mono text-micro text-muted-foreground uppercase">{t(`kind.${item.kind}`)}</span>
        </span>
        <ItemNotes item={item} />
        <PhoneStrip item={item} viewerRole={viewerRole} />
      </th>
      {PAGE_ROLES.map((role) => (
        <td
          key={role}
          data-role={role}
          className={cn("hidden px-1.5 py-1.5 text-center sm:table-cell", role === viewerRole && "bg-primary/10")}
        >
          <RoleCell kind={item.kind} offered={item.chat[role]} />
        </td>
      ))}
      <td className="hidden border-s border-rule py-1.5 ps-3 sm:table-cell" data-mcp={item.mcp}>
        <McpCell mode={item.mcp} audience={item.mcpAudience} />
      </td>
    </tr>
  );
}

/**
 * Below `sm` the role and MCP columns are hidden and each row carries this
 * one line instead — every role's mark and the MCP mode — so a phone reads
 * the whole matrix without scrolling sideways. The viewer's role is tinted.
 */
function PhoneStrip({ item, viewerRole }: { item: CapabilityItem; viewerRole: PageRole }) {
  const t = useTranslations("assistantPage");
  return (
    <span data-slot="phone-strip" className="mt-1 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-micro text-muted-foreground sm:hidden">
      {PAGE_ROLES.map((role) => (
        <span key={role} data-role={role} className={cn("inline-flex items-baseline gap-1", role === viewerRole && "bg-primary/10 px-1 text-foreground")}>
          {t(`roles.${role}`)}
          <RoleCell kind={item.kind} offered={item.chat[role]} />
        </span>
      ))}
      <span className="inline-flex items-baseline gap-1 border-s border-rule ps-2.5">
        {t("roles.mcpShort")}
        <McpCell mode={item.mcp} audience={item.mcpAudience} />
      </span>
    </span>
  );
}

/** The small notes under a row's label: credits, typed name, batch, outside text, super admin. */
function ItemNotes({ item }: { item: CapabilityItem }) {
  const t = useTranslations("assistantPage");
  if (item.kind === "pageOnly") {
    return (
      <span className="block text-micro text-muted-foreground">
        {item.reasonKey && t.has(item.reasonKey) ? t(item.reasonKey) : t("pageOnlyNote")}
      </span>
    );
  }
  if (item.flags.length === 0) return null;
  return (
    <span className="mt-0.5 flex flex-wrap gap-x-2 gap-y-0.5 text-micro">
      {item.flags.map((flag) => (
        <span
          key={flag}
          data-flag={flag}
          className={cn(
            "text-muted-foreground",
            flag === "spend" && "text-warn",
            flag === "typedName" && "text-bad"
          )}
        >
          {flag === "batch" ? t("flags.batch", { count: item.maxBatch }) : t(`flags.${flag}`)}
        </span>
      ))}
    </span>
  );
}

function RoleCell({ kind, offered }: { kind: ItemKind; offered: boolean }) {
  const t = useTranslations("assistantPage");
  if (!offered) return <StatusGlyph compact tone="muted" label={t("cell.no")} />;
  if (kind === "propose") return <StatusGlyph compact tone="active" label={t("cell.proposes")} />;
  return <StatusGlyph compact tone="ok" label={t("cell.yes")} />;
}

const MCP_TONE: Record<McpMode, "ok" | "active" | "warn" | "muted"> = {
  read: "ok",
  record: "ok",
  inbox: "active",
  direct: "warn",
  none: "muted",
};

function McpCell({ mode, audience }: { mode: McpMode; audience: CapabilityItem["mcpAudience"] }) {
  const t = useTranslations("assistantPage");
  if (mode === "none") return <StatusGlyph compact tone="muted" label={t("cell.no")} />;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1.5">
      <StatusGlyph tone={MCP_TONE[mode]} label={t(`mcpMode.${mode}`)} />
      {audience ? <span className="text-micro text-muted-foreground">· {t(`audience.${audience}`)}</span> : null}
    </span>
  );
}
