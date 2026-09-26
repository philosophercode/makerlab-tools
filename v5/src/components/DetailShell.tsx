import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import type { MakerLabProject, MakerLabTool } from "./catalog-types";
import { ManualContentsList } from "./ManualContentsList";
import type { ManualContents } from "../lib/data/manual-documents";
import type { ToolMaintenanceEntry } from "../lib/data/maintenance";
import { officialNameShown } from "../lib/tool-names";
import { isoDay } from "../lib/iso-day";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "./system/EmptyState";
import { Markdown } from "./system/Markdown";
import { StatusGlyph, type StatusTone } from "./system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "./ToolCard";
import { ToolImage } from "./ToolImage";
import { UnitsTable } from "./tool/UnitsTable";

interface DetailShellProps {
  tool: MakerLabTool;
  /** Published projects that reference this tool ("Built with this"). */
  projects?: MakerLabProject[];
  /** Processed manuals' outlines, keyed by the PDF link the page shows (manual text spec §6). */
  manualContents?: ManualContents[];
  /** The most recent maintenance logs across the tool's units, without names. */
  maintenance?: ToolMaintenanceEntry[];
}

function resourceLabel(link: MakerLabTool["links"][number], fallback: string): string {
  if (link.label && !/^https?:\/\//i.test(link.label)) return link.label;
  if (link.kind) return link.kind;
  return fallback;
}

function findResource(tool: MakerLabTool, kind: string): MakerLabTool["links"][number] | undefined {
  return tool.links.find((link) => link.kind === kind);
}

/** A maintenance log's status as a glyph tone: open work is a warn, settled work is muted. */
function maintenanceTone(status: string): StatusTone {
  const value = status.toLowerCase();
  if (value === "open") return "warn";
  if (value === "in progress") return "idle";
  if (value === "resolved" || value === "closed") return "muted";
  return "idle";
}

/**
 * One tool's page (UI system spec §8.2, phase 5a): **one column of facts, not
 * panels.** The hero (image, name, official name, a status line of glyphs and
 * words, the description, the safety and SOP documents), then Safety — the one
 * tinted section — then the specifications as a dense `<dl>`, the resources
 * with their manual Contents, the machines as a `DataTable`, the recent
 * maintenance history and the projects built with it.
 *
 * The rounded `td-*` panels (which the global square rule had already
 * flattened) and the "at a glance" card that repeated the materials are gone.
 */
export function DetailShell({ tool, projects = [], manualContents = [], maintenance = [] }: DetailShellProps) {
  const t = useTranslations("detail");
  const tStatus = useTranslations("gallery.status");
  const tUi = useTranslations("ui");
  const safetyLink = findResource(tool, "Safety");
  const sopLink = findResource(tool, "SOP");
  const officialName = officialNameShown(tool);
  const available = tool.units.filter((unit) => unit.status === "Available").length;

  const specs: Array<[string, React.ReactNode]> = [
    [t("category"), `${tool.category}${tool.categorySub ? ` › ${tool.categorySub}` : ""}`],
    [t("location"), `${tool.location}${tool.zone ? ` › ${tool.zone}` : ""}`],
    [t("materials"), tool.materials.length > 0 ? tool.materials.join(", ") : <span className="text-muted-foreground">{t("contactStaff")}</span>],
    [t("trainingRow"), tool.trainingLabel],
    ...(tool.mapId ? ([[t("mapId"), <code key="map" className="font-mono text-xs">{tool.mapId}</code>]] as Array<[string, React.ReactNode]>) : []),
    ...(tool.tags.length > 0 ? ([[t("tags"), tool.tags.join(", ")]] as Array<[string, React.ReactNode]>) : []),
    ...(tool.notes ? ([[t("notes"), tool.notes]] as Array<[string, React.ReactNode]>) : []),
  ];

  return (
    <main data-slot="tool-page" className="ui mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-10 px-4 pt-6 pb-16 sm:px-8">
      <nav data-slot="tool-breadcrumbs" aria-label={tUi("breadcrumb")} className="font-mono text-label text-muted-foreground uppercase">
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        <Link href="/" className="hover:text-foreground">
          {t("breadcrumbTools")}
        </Link>
        <span aria-hidden="true"> / </span>
        <span>{t("breadcrumbInventory")}</span>
        <span aria-hidden="true"> / </span>
        <span aria-current="page">{tool.name}</span>
      </nav>

      <section data-slot="tool-hero" className="grid min-w-0 gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10">
        <ToolImage
          src={tool.imageSrc}
          name={tool.name}
          sizes="(min-width: 768px) 40vw, 100vw"
          className="aspect-[4/3] w-full border border-border bg-card p-6"
        />
        <div className="flex min-w-0 flex-col gap-3">
          <h1 className="font-heading text-[clamp(36px,5vw,64px)] leading-[0.95] font-medium tracking-tight uppercase">{tool.name}</h1>
          {/* The official name, under the display name, when it says more
              (tool display names spec §6). Data, not a translated string. */}
          {officialName ? (
            <p data-slot="official-name" className="font-mono text-label tracking-[0.04em] text-muted-foreground">
              {officialName}
            </p>
          ) : null}
          <p
            data-slot="tool-status-line"
            aria-label={t("toolStatusLabel")}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5 font-mono text-label uppercase"
          >
            <StatusGlyph tone={TOOL_STATUS_TONE[tool.status]} label={tStatus(TOOL_STATUS_KEY[tool.status])} />
            <StatusGlyph tone="warn" label={t("trainingChip", { level: tool.trainingLevel })} />
            {tool.ppe.length > 0 ? <StatusGlyph tone="bad" label={t("ppeRequired")} /> : null}
            <span className="text-muted-foreground tabular-nums">{t("unitsAvailable", { available, count: tool.units.length })}</span>
          </p>
          {/* Descriptions are Markdown (research folds specs in as a list); no raw HTML, as for projects. */}
          <Markdown className="max-w-[68ch] text-[15px]">{tool.description}</Markdown>
          {safetyLink || sopLink ? (
            <div className="flex flex-wrap gap-2 pt-1">
              {safetyLink ? (
                <Button asChild variant="default">
                  <a href={safetyLink.href}>
                    {t("viewSafetyDoc")}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
              {sopLink ? (
                <Button asChild variant="outline">
                  <a href={sopLink.href}>
                    {t("viewSop")}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      {/* Safety: the one place a tinted section is justified (spec §8.2). */}
      <section aria-labelledby="tool-safety" data-slot="tool-safety" className="border-s-4 border-s-bad bg-bad/5 px-4 py-5 sm:px-6">
        <h2 id="tool-safety" className="mb-4 font-heading text-lg font-medium text-bad uppercase">
          {t("safetyAccess")}
        </h2>
        <dl className="grid gap-5 md:grid-cols-3">
          <div className="flex flex-col gap-2">
            <dt className="font-mono text-label tracking-[0.08em] uppercase">{t("ppeRequired")}</dt>
            <dd className="flex flex-col gap-2">
              <span className="flex flex-wrap gap-1.5">
                {tool.ppe.map((item) => (
                  <Badge key={item} className="border-bad/40 text-label text-foreground">
                    {item}
                  </Badge>
                ))}
              </span>
              <span className="text-sm text-muted-foreground">{t("ppeNotice")}</span>
            </dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="font-mono text-label tracking-[0.08em] uppercase">{t("emergencyStop")}</dt>
            <dd className="text-sm">{tool.emergencyStop || t("emergencyStopFallback")}</dd>
          </div>
          <div className="flex flex-col gap-2">
            <dt className="font-mono text-label tracking-[0.08em] uppercase">{t("useRestrictions")}</dt>
            <dd className="text-sm">{tool.useRestrictions || t("useRestrictionsFallback")}</dd>
          </div>
        </dl>
      </section>

      <div className="grid min-w-0 gap-10 lg:grid-cols-2">
        <section aria-labelledby="tool-details" className="min-w-0">
          <SectionHeading id="tool-details">{t("details")}</SectionHeading>
          <dl data-slot="tool-specs" className="border-t border-rule text-table">
            {specs.map(([term, value]) => (
              <div key={term} className="grid grid-cols-[minmax(7rem,1fr)_minmax(0,2.4fr)] gap-3 border-b border-rule py-2">
                <dt className="font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{term}</dt>
                <dd className="min-w-0 break-words">{value}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section aria-labelledby="tool-resources" className="min-w-0">
          <SectionHeading id="tool-resources">{t("documentsResources")}</SectionHeading>
          {tool.links.length > 0 ? (
            <ul className="m-0 list-none border-t border-rule p-0">
              {tool.links.map((link) => {
                const contents = manualContents.find((entry) => entry.href === link.href);
                return (
                  <li key={`${link.kind}-${link.href}`} className="border-b border-rule py-2">
                      <a
                        href={link.href}
                        className="group grid grid-cols-[6.5rem_minmax(0,1fr)_auto] items-baseline gap-3"
                        // The lab's own document may be private (a Google Doc): open it apart, share nothing.
                        {...(link.labDocument ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      >
                        <span className={resourceKindClass(link)}>
                          {link.labDocument ? t("labDocument") : link.kind || t("resourceFallback")}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <strong className="text-sm font-medium group-hover:text-primary-ink group-hover:underline">
                            {resourceLabel(link, t("openResource"))}
                          </strong>
                          {link.description ? <span className="text-xs text-muted-foreground">{link.description}</span> : null}
                        </span>
                        <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                      </a>
                      {contents ? <ManualContentsList href={link.href} outline={contents.outline} /> : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState>{t("noDocuments")}</EmptyState>
          )}
        </section>
      </div>

      {tool.units.length > 0 ? (
        <section aria-labelledby="tool-units" className="min-w-0">
          <SectionHeading id="tool-units">{t("physicalMachines")}</SectionHeading>
          <UnitsTable units={tool.units} />
        </section>
      ) : null}

      <section aria-labelledby="tool-maintenance" className="min-w-0">
        <SectionHeading id="tool-maintenance">{t("maintenanceHistory")}</SectionHeading>
        {maintenance.length > 0 ? (
          <ol className="m-0 list-none border-t border-rule p-0 text-table">
            {maintenance.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-rule py-2 sm:grid-cols-[6.5rem_9rem_minmax(0,1fr)_minmax(0,12rem)]"
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{isoDay(entry.dateReported) || "–"}</span>
                <span className="sm:order-none">
                  <StatusGlyph tone={maintenanceTone(entry.status)} label={entry.status || t("maintenanceNoStatus")} />
                </span>
                <span className="col-span-2 min-w-0 sm:col-span-1">
                  {entry.title}
                  {entry.type ? <span className="text-muted-foreground"> · {entry.type}</span> : null}
                </span>
                <span className="col-span-2 min-w-0 truncate text-xs text-muted-foreground sm:col-span-1 sm:text-end">{entry.unitLabel}</span>
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState>{t("maintenanceEmpty")}</EmptyState>
        )}
      </section>

      {projects.length > 0 ? (
        <section aria-labelledby="tool-projects" className="min-w-0">
          <SectionHeading id="tool-projects">{t("builtWithThis")}</SectionHeading>
          <ul className="m-0 list-none border-t border-rule p-0">
            {projects.map((project) => (
              <li key={project.id} className="border-b border-rule py-2">
                <Link href={`/projects/${project.slug}`} className="group flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <strong className="text-sm font-medium group-hover:text-primary-ink group-hover:underline">{project.title}</strong>
                    <span className="text-xs text-muted-foreground">{t("builtWithThisBy", { author: project.author })}</span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div>
        <Button asChild variant="ghost">
          <Link href="/">{t("backToTools")}</Link>
        </Button>
      </div>
    </main>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-3 font-heading text-lg font-medium uppercase">
      {children}
    </h2>
  );
}

/** A resource's kind as a mono label; Safety in the bad ink, the lab's own documents in the accent ink. */
function resourceKindClass(link: MakerLabTool["links"][number]): string {
  const base = "font-mono text-micro tracking-[0.08em] uppercase";
  if (link.labDocument) return `${base} text-primary-ink`;
  if (link.kind === "Safety") return `${base} text-bad`;
  return `${base} text-muted-foreground`;
}

