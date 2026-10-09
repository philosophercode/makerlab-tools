import Link from "next/link";
import { useTranslations } from "next-intl";
import { ArrowUpRight, FileSearch } from "lucide-react";
import type { MakerLabProject, MakerLabTool } from "./catalog-types";
import { ManualContentsList } from "./ManualContentsList";
import type { ManualContents } from "../lib/data/manual-documents";
import type { ToolMaintenanceEntry } from "../lib/data/maintenance";
import { officialNameShown } from "../lib/tool-names";
import { isoDay } from "../lib/iso-day";
import { allToolsHref, categoryHref } from "../lib/gallery-links";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Markdown } from "./system/Markdown";
import { StatusGlyph, type StatusTone } from "./system/StatusGlyph";
import { TOOL_STATUS_KEY, TOOL_STATUS_TONE } from "./ToolCard";
import { ToolImage } from "./ToolImage";
import { LabNotes } from "./tool/LabNotes";
import { ToolReportActions } from "./tool/report/ToolReportActions";
import { UnitsTable } from "./tool/UnitsTable";
import type { ToolRelations } from "./tool/relations";

interface DetailShellProps {
  tool: MakerLabTool;
  /** Published projects that reference this tool ("Built with this"). */
  projects?: MakerLabProject[];
  /** Processed manuals' outlines, keyed by the PDF link the page shows (manual text spec §6). */
  manualContents?: ManualContents[];
  /** The most recent maintenance logs across the tool's units, without names. */
  maintenance?: ToolMaintenanceEntry[];
  /**
   * "Where it is" (floor map spec §6.2). The page passes it in its own
   * Suspense boundary and only a signed-in viewer gets anything (map access).
   */
  location?: React.ReactNode;
  /**
   * The mini-map beside the photo (`map/ToolMiniMap`). Like `location`, the
   * page passes it in its own Suspense boundary, signed-in viewers only.
   */
  heroMap?: React.ReactNode;
  /**
   * The units table, when the page builds it per viewer (`tool/UnitsForViewer`
   * in its own Suspense boundary: whole serials for staff only, the masked last
   * four for everyone else). Absent, the table is drawn from `tool.units` as
   * they are.
   */
  unitsTable?: React.ReactNode;
  /**
   * Accessory links (taxonomy v2 facet): the tool this one is an accessory of,
   * and the published accessories of this one. Empty is absent.
   */
  relations?: ToolRelations;
  /**
   * Report a problem and Ask MakerLAB AI in the hero (quick report spec §6).
   * Off for a draft: the report files only against a published tool.
   */
  reportActions?: boolean;
  /**
   * "On shift now: Alex M." (on-shift spec 2026-10-07), under the hero's
   * buttons, where a student about to use the machine or report a problem
   * looks for somebody to ask. The page passes it in its own Suspense
   * boundary; nobody on shift renders nothing.
   */
  onShift?: React.ReactNode;
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
 * One tool's page (UI system spec §8.2, phase 5a; dense layout, public
 * polish). Tufte's rule is the brief: every mark a reading somebody needs, and
 * nothing drawn for a fact the tool does not have.
 *
 * - **Hero**: a small image plate (and, signed in, the mini-map — beside it
 *   on a phone, under it from `sm`) beside the name, official name, a status
 *   line on one line (status, training, PPE, units available), the lab's
 *   own **Lab notes** when there are any (above the description: the lab's
 *   word before the manufacturer's), the description and the Safety doc /
 *   SOP buttons.
 * - **Two columns on desktop** (one on a phone): Safety & access — the one
 *   tinted block, compact rows — then Details as a dense `<dl>` on the left;
 *   Documents & resources (with each manual's Contents) and the machines on the
 *   right. Maintenance history and Built with this follow across the page.
 * - **Empty is absent.** A section or row with nothing to say is not drawn —
 *   no "Contact MakerLab staff" materials row, no "No documents linked yet"
 *   box, no empty maintenance history. Safety is the exception: it always
 *   says what to do, falling back to the lab's standing guidance.
 */
export function DetailShell({ tool, projects = [], manualContents = [], maintenance = [], location = null, heroMap = null, unitsTable, relations, reportActions = true, onShift = null }: DetailShellProps) {
  const t = useTranslations("detail");
  const tStatus = useTranslations("gallery.status");
  const tUi = useTranslations("ui");
  const safetyLink = findResource(tool, "Safety");
  const sopLink = findResource(tool, "SOP");
  const officialName = officialNameShown(tool);
  const available = tool.units.filter((unit) => unit.status === "Available").length;
  const hasPhoto = Boolean(tool.imageSrc || tool.thumbnails);

  type Row = [string, React.ReactNode];
  const specs: Row[] = [
    // The category and the room link to the gallery filtered by them (map UX
    // pass, cross-links): the same facet values the gallery offers.
    [
      t("category"),
      <span key="category">
        <Link data-slot="category-link" href={categoryHref(tool.category)} className="text-primary-ink hover:underline">
          {tool.category}
        </Link>
        {tool.categorySub && tool.categorySub !== tool.category ? ` › ${tool.categorySub}` : ""}
      </span>,
    ],
    ...(tool.itemKind && tool.itemKind !== "equipment" ? ([[t("itemKindRow"), t(`itemKind.${tool.itemKind}`)]] as Row[]) : []),
    ...(relations?.accessoryOf
      ? ([
          [
            t("accessoryOf"),
            <Link key="parent" data-slot="accessory-of" href={`/tools/${relations.accessoryOf.slug}`} className="text-primary-ink hover:underline">
              {relations.accessoryOf.name}
            </Link>,
          ],
        ] as Row[])
      : []),
    [
      t("location"),
      <span key="location">
        <Link data-slot="location-link" href={allToolsHref({ location: tool.location })} className="text-primary-ink hover:underline">
          {tool.location}
        </Link>
        {tool.zone ? ` › ${tool.zone}` : ""}
      </span>,
    ],
    ...(tool.materials.length > 0 ? ([[t("materials"), tool.materials.join(", ")]] as Row[]) : []),
    ...(tool.trainingLabel ? ([[t("trainingRow"), tool.trainingLabel]] as Row[]) : []),
    ...(tool.mapId ? ([[t("mapId"), <code key="map" className="font-mono text-xs">{tool.mapId}</code>]] as Row[]) : []),
    ...(tool.tags.length > 0 ? ([[t("tags"), tool.tags.join(", ")]] as Row[]) : []),
    // The tool's notes are its Lab notes, in the hero (identity spec amendment "Lab notes"), not a row here.
  ];

  const safety: Row[] = [
    ...(tool.ppe.length > 0
      ? ([
          [
            t("ppeRequired"),
            <span key="ppe" className="flex flex-wrap items-baseline gap-1.5">
              {tool.ppe.map((item) => (
                <Badge key={item} className="border-bad/40 text-label text-foreground">
                  {item}
                </Badge>
              ))}
              <span className="text-xs text-muted-foreground">{t("ppeNotice")}</span>
            </span>,
          ],
        ] as Row[])
      : []),
    ...(tool.emergencyStop ? ([[t("emergencyStop"), tool.emergencyStop]] as Row[]) : []),
    ...(tool.useRestrictions ? ([[t("useRestrictions"), tool.useRestrictions]] as Row[]) : []),
  ];

  return (
    <main data-slot="tool-page" className="ui mx-auto flex w-full max-w-[1200px] min-w-0 flex-col gap-8 px-4 pt-5 pb-16 sm:px-8">
      <nav data-slot="tool-breadcrumbs" aria-label={tUi("breadcrumb")} className="font-mono text-label text-muted-foreground uppercase">
        <span aria-hidden="true" className="text-primary-ink">
          {"// "}
        </span>
        <Link href="/" className="hover:text-foreground">
          {t("breadcrumbTools")}
        </Link>
        <span aria-hidden="true"> › </span>
        <span aria-current="page">{tool.name}</span>
      </nav>

      <section data-slot="tool-hero" className="grid min-w-0 gap-5 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)] md:grid-cols-[minmax(0,16rem)_minmax(0,1fr)] md:gap-8">
        {/* The photo and, for signed-in people, the mini-map (`heroMap`):
            side by side on a phone, stacked in the image column from `sm` up.
            The photo is first and fixed in size, so the map streaming in
            beside it never moves it. */}
        <div data-slot="tool-hero-media" className="group/hero-media flex min-w-0 gap-3 sm:flex-col">
          <ToolImage
            src={tool.imageSrc}
            thumbnails={tool.thumbnails}
            name={tool.name}
            // The plate's width: the column (16rem / 13rem), capped at 12rem
            // on a phone.
            sizes="(min-width: 768px) 256px, (min-width: 640px) 208px, 192px"
            // The page's LCP element: fetched first, never lazily.
            priority="high"
            className={cn(
              "aspect-[4/3] w-full max-w-[12rem] shrink-0 border border-border bg-card p-3 sm:max-w-none",
              // No photo: the initials plate gives way to the map when there
              // is one, so only the picture that exists is drawn.
              !hasPhoto && "group-has-[[data-slot=tool-minimap]]/hero-media:hidden",
            )}
          />
          {heroMap}
        </div>
        <div className="flex min-w-0 flex-col gap-2.5">
          <h1 className="font-heading text-[clamp(30px,4vw,48px)] leading-[0.95] font-medium tracking-tight uppercase">{tool.name}</h1>
          {/* The official name, under the display name, when it says more
              (tool display names spec §6). Data, not a translated string. */}
          {officialName ? (
            <p data-slot="official-name" className="font-mono text-label tracking-[0.04em] text-muted-foreground">
              {officialName}
            </p>
          ) : null}
          <p
            data-slot="tool-status-line"
            // A name needs a role: aria-label on a bare <p> is prohibited and ignored.
            role="group"
            aria-label={t("toolStatusLabel")}
            // Wraps between labels at every width: the hero's text column can be
            // narrower than the four labels just past the md breakpoint.
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 font-mono text-label whitespace-nowrap uppercase"
          >
            <StatusGlyph tone={TOOL_STATUS_TONE[tool.status]} label={tStatus(TOOL_STATUS_KEY[tool.status])} />
            <StatusGlyph tone="warn" label={t("trainingChip", { level: tool.trainingLevel })} />
            {tool.ppe.length > 0 ? <StatusGlyph tone="bad" label={t("ppeRequired")} /> : null}
            {tool.units.length > 0 ? (
              <span className="text-muted-foreground tabular-nums">{t("unitsAvailable", { available, count: tool.units.length })}</span>
            ) : null}
          </p>
          {/* Report a problem, front and centre, with Ask MakerLAB AI beside
              it (quick report spec §6). */}
          {reportActions ? (
            <ToolReportActions
              toolSlug={tool.slug}
              toolName={tool.name}
              units={tool.units.map((unit) => ({ id: unit.id, name: unit.name, status: unit.status }))}
            />
          ) : null}
          {/* The lab's own rules and tips, before the generic description (identity spec amendment "Lab notes"). */}
          <LabNotes notes={tool.notes} />
          {/* Descriptions are Markdown (older ones may carry a spec list); no raw HTML, as for projects. */}
          <Markdown className="max-w-[72ch] text-[15px]">{tool.description}</Markdown>
          {safetyLink || sopLink ? (
            <div className="flex flex-wrap gap-2 pt-0.5">
              {safetyLink ? (
                <Button asChild variant="default" size="sm">
                  <a href={safetyLink.href}>
                    {t("viewSafetyDoc")}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
              {sopLink ? (
                <Button asChild variant="outline" size="sm">
                  <a href={sopLink.href}>
                    {t("viewSop")}
                    <ArrowUpRight aria-hidden="true" />
                  </a>
                </Button>
              ) : null}
            </div>
          ) : null}
          {onShift}
        </div>
      </section>

      {/* Where it is on the floor map (floor map spec §6.2): a slot the page
          fills for signed-in viewers only (map access, PR #98). */}
      {location}

      <div data-slot="tool-columns" className="grid min-w-0 gap-8 lg:grid-cols-2 lg:gap-10">
        <div className="flex min-w-0 flex-col gap-8">
          {/* Safety: the one place a tinted section is justified (spec §8.2). */}
          <section aria-labelledby="tool-safety" data-slot="tool-safety" className="border-s-4 border-s-bad bg-bad/5 px-4 py-3">
            <h2 id="tool-safety" className="mb-2 font-heading text-base font-medium text-bad uppercase">
              {t("safetyAccess")}
            </h2>
            {safety.length > 0 ? (
              <FactList rows={safety} ruled={false} />
            ) : (
              <p className="text-sm">{t("emergencyStopFallback")}</p>
            )}
          </section>

          <section aria-labelledby="tool-details" className="min-w-0">
            <SectionHeading id="tool-details">{t("details")}</SectionHeading>
            <FactList rows={specs} slot="tool-specs" />
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-8">
          {tool.links.length > 0 ? (
            <section aria-labelledby="tool-resources" className="min-w-0">
              <SectionHeading id="tool-resources">{t("documentsResources")}</SectionHeading>
              <ul className="m-0 list-none border-t border-rule p-0">
                {tool.links.map((link) => {
                  const contents = manualContents.find((entry) => entry.href === link.href);
                  return (
                    <li key={`${link.kind}-${link.href}`} className="border-b border-rule py-1.5">
                      <a
                        href={link.href}
                        className="group grid grid-cols-[5.5rem_minmax(0,1fr)_auto] items-baseline gap-3"
                        // The lab's own document may be private (a Google Doc): open it apart, share nothing.
                        {...(link.labDocument ? { target: "_blank", rel: "noopener noreferrer" } : {})}
                      >
                        <span className={resourceKindClass(link)}>
                          {link.labDocument ? t("labDocument") : link.kind || t("resourceFallback")}
                        </span>
                        <span className="flex min-w-0 flex-col">
                          <strong className="text-table font-medium group-hover:text-primary-ink group-hover:underline">
                            {resourceLabel(link, t("openResource"))}
                          </strong>
                          {link.description ? <span className="text-xs text-muted-foreground">{link.description}</span> : null}
                        </span>
                        <span className="flex items-center gap-1.5">
                          {/* The lab's stored copy is searchable by the assistant (manual text spec §6). */}
                          {contents?.searchable ? (
                            <span data-slot="searchable-manual" title={t("searchableManual")} className="inline-flex text-primary-ink">
                              <FileSearch aria-hidden="true" className="size-3.5" />
                              <span className="sr-only">{t("searchableManual")}</span>
                            </span>
                          ) : null}
                          <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                        </span>
                      </a>
                      {contents && contents.outline.length > 0 ? <ManualContentsList href={link.href} outline={contents.outline} /> : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ) : null}

          {tool.units.length > 0 ? (
            <section aria-labelledby="tool-units" className="min-w-0">
              <SectionHeading id="tool-units">{t("physicalMachines")}</SectionHeading>
              {unitsTable ?? <UnitsTable units={tool.units} />}
            </section>
          ) : null}
        </div>
      </div>

      {relations && relations.accessories.length > 0 ? (
        <section aria-labelledby="tool-accessories" data-slot="tool-accessories" className="min-w-0">
          <SectionHeading id="tool-accessories">{t("accessories")}</SectionHeading>
          <ul className="m-0 list-none border-t border-rule p-0">
            {relations.accessories.map((accessory) => (
              <li key={accessory.slug} className="border-b border-rule py-1.5">
                <Link href={`/tools/${accessory.slug}`} className="group flex items-baseline justify-between gap-3">
                  <strong className="text-table font-medium group-hover:text-primary-ink group-hover:underline">{accessory.name}</strong>
                  <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {maintenance.length > 0 ? (
        <section aria-labelledby="tool-maintenance" className="min-w-0">
          <SectionHeading id="tool-maintenance">{t("maintenanceHistory")}</SectionHeading>
          <ol className="m-0 list-none border-t border-rule p-0 text-table">
            {maintenance.map((entry) => (
              <li
                key={entry.id}
                className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-b border-rule py-1.5 sm:grid-cols-[6.5rem_9rem_minmax(0,1fr)_minmax(0,12rem)]"
              >
                <span className="font-mono text-xs text-muted-foreground tabular-nums">{isoDay(entry.dateReported) || "–"}</span>
                <span>
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
        </section>
      ) : null}

      {projects.length > 0 ? (
        <section aria-labelledby="tool-projects" className="min-w-0">
          <SectionHeading id="tool-projects">{t("builtWithThis")}</SectionHeading>
          <ul className="m-0 list-none border-t border-rule p-0">
            {projects.map((project) => (
              <li key={project.id} className="border-b border-rule py-1.5">
                <Link href={`/projects/${project.slug}`} className="group flex items-baseline justify-between gap-3">
                  <span className="flex min-w-0 flex-col">
                    <strong className="text-table font-medium group-hover:text-primary-ink group-hover:underline">{project.title}</strong>
                    <span className="text-xs text-muted-foreground">{t("builtWithThisBy", { author: project.author })}</span>
                  </span>
                  <ArrowUpRight aria-hidden="true" className="size-3.5 text-muted-foreground" />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}

/** Label/value rows: a mono label column and the value, hairline-ruled unless inside the tinted Safety block. */
function FactList({ rows, ruled = true, slot }: { rows: Array<[string, React.ReactNode]>; ruled?: boolean; slot?: string }) {
  return (
    <dl data-slot={slot} className={ruled ? "border-t border-rule text-table" : "flex flex-col gap-1.5 text-table"}>
      {rows.map(([term, value]) => (
        <div
          key={term}
          className={`grid grid-cols-[minmax(6.5rem,1fr)_minmax(0,2.6fr)] gap-3 ${ruled ? "border-b border-rule py-1.5" : ""}`}
        >
          <dt className="pt-px font-mono text-label tracking-[0.08em] text-muted-foreground uppercase">{term}</dt>
          <dd className="min-w-0 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function SectionHeading({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="mb-2 font-heading text-base font-medium uppercase">
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

