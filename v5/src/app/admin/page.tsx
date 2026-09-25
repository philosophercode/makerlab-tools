import { getTranslations } from "next-intl/server";
import {
  BookOpenText,
  Boxes,
  FileSpreadsheet,
  Flag,
  GalleryVerticalEnd,
  PackagePlus,
  RefreshCw,
  Share2,
  Users,
  Wrench,
} from "lucide-react";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { can } from "../../lib/auth/permissions";
import { AdminActions } from "../../components/admin/AdminActions";
import { isLegacyMcpTokenSet } from "../../lib/auth/mcp-caller";
import { ADMIN_GROUPS, ADMIN_SURFACES, type AdminGroup } from "../../lib/admin/surfaces";
import { loadAdminOverview, type AdminOverview } from "../../lib/data/admin-overview";
import { getMirrorViewForOwner } from "../../lib/data/mirrors";
import { PageHeader } from "../../components/system/PageHeader";
import { Tile, TileGroup, type TileProps } from "../../components/system/Tile";

/**
 * `/admin` — the home: one tile per surface, grouped by the job it serves,
 * each with its live count (UI system spec §6.1; data platform spec §6
 * `AdminHome`, which this finally builds).
 *
 * **Honest, as before.** The tiles are exactly the surfaces the viewer's own
 * permissions open (`ADMIN_SURFACES`, the same list the section bar uses, each
 * checked with the `can()` the page itself calls), so nobody follows a tile
 * into a refusal. A count that cannot be read is said to be unreadable — never
 * shown as a zero, which would claim there is no work (Article 4).
 *
 * The counts are one aggregate read (`loadAdminOverview`); the mirror tile is
 * the viewer's *own* mirror, found by owner, never by an id (§8).
 */

type TileSpec = Omit<TileProps, "href" | "title">;

export default async function AdminHomePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const open = ADMIN_SURFACES.filter((surface) => can(identity, surface.permission));

  const [overview, mirror] = await Promise.all([
    loadAdminOverview().catch(() => null),
    can(identity, "mirror.manage") && identity.userId
      ? getMirrorViewForOwner(identity.userId).catch(() => null)
      : Promise.resolve(null),
  ]);

  const tiles = tileSpecs(overview, mirror, (key, values) => t(`home.${key}`, values));

  return (
    <div className="flex flex-col gap-8">
      <PageHeader
        crumbs={[{ label: t("eyebrow") }]}
        title={t("home.title")}
        lede={t("home.lede")}
        actions={<AdminActions role={identity.role} />}
      />

      {/* MCP access spec §5.3: the retired shared secret still works for one
          release, as the public read-only tools only — and says so here. */}
      {isLegacyMcpTokenSet() ? (
        <p className="admin-row-status is-warning" role="status">
          {t("mcpTokenDeprecated")}
        </p>
      ) : null}

      {open.length === 0 ? <p>{t("indexNothingYet")}</p> : null}

      {/* One column per job: the four columns are small multiples of the same
          question — "is there work here?" — read left to right in the order
          equipment moves through the lab. */}
      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
        {ADMIN_GROUPS.map((group: AdminGroup) => {
          const surfaces = open.filter((surface) => surface.group === group);
          if (surfaces.length === 0) return null;
          return (
            <TileGroup key={group} id={`admin-group-${group}`} title={t(`nav.group.${group}`)}>
              {surfaces.map((surface) => (
                <Tile
                  key={surface.key}
                  href={surface.href}
                  title={t(`nav.surface.${surface.key}`)}
                  {...tiles[surface.key]}
                />
              ))}
            </TileGroup>
          );
        })}
      </div>
    </div>
  );
}

/** Every tile's content, from one overview read. */
function tileSpecs(
  o: AdminOverview | null,
  mirror: Awaited<ReturnType<typeof getMirrorViewForOwner>>,
  t: (key: string, values?: Record<string, string | number>) => string
): Record<string, TileSpec> {
  const unavailable = t("unavailable");
  const caption = t("seriesCaption");
  const sum = (values: readonly number[]) => values.reduce((a, b) => a + b, 0);
  const v = (value: number | undefined) => (o ? (value ?? 0) : null);

  return {
    intake: {
      icon: <PackagePlus />,
      value: v(o?.intake.researched),
      unit: t("intakeUnit"),
      attention: (o?.intake.researched ?? 0) > 0,
      note: unavailable,
      facts: o
        ? [
            { label: t("intakeIdentified"), value: o.intake.identified, tone: "idle" },
            { label: t("intakeResearching"), value: o.intake.researching, tone: "active" },
            { label: t("intakeFailed"), value: o.intake.failed, tone: o.intake.failed > 0 ? "bad" : "idle" },
          ]
        : [],
      series: o
        ? { values: o.series.intake, caption, label: t("intakeSeries", { total: sum(o.series.intake) }) }
        : undefined,
    },
    import: {
      icon: <FileSpreadsheet />,
      value: v(o?.imports.ready),
      unit: t("importUnit"),
      attention: (o?.imports.ready ?? 0) > 0,
      note: unavailable,
      facts: o ? [{ label: t("importLast30"), value: o.imports.last30 }] : [],
    },
    inventory: {
      icon: <Boxes />,
      value: v(o?.inventory.needsAttention),
      unit: t("inventoryUnit"),
      note: unavailable,
      facts: o
        ? [
            { label: t("inventoryTotal"), value: o.inventory.total },
            { label: t("inventoryNoPhoto"), value: o.inventory.noPhoto, tone: o.inventory.noPhoto ? "warn" : "ok" },
            { label: t("inventoryNoManual"), value: o.inventory.noManual, tone: o.inventory.noManual ? "warn" : "ok" },
            {
              label: t("inventoryNeverReviewed"),
              value: o.inventory.neverReviewed,
              tone: o.inventory.neverReviewed ? "warn" : "ok",
            },
          ]
        : [],
    },
    refresh: {
      icon: <RefreshCw />,
      value: v(o?.refresh.proposed),
      unit: t("refreshUnit"),
      attention: (o?.refresh.proposed ?? 0) > 0,
      note: unavailable,
      facts: o
        ? [
            { label: t("refreshRunning"), value: o.refresh.running, tone: "active" },
            { label: t("refreshFailed"), value: o.refresh.failed, tone: o.refresh.failed ? "bad" : "idle" },
          ]
        : [],
    },
    research: {
      icon: <BookOpenText />,
      value: v(o?.manuals.searchable),
      unit: t("manualsUnit"),
      note: unavailable,
      facts: o ? [{ label: t("manualsTotal"), value: o.manuals.total }] : [],
    },
    maintenance: {
      icon: <Wrench />,
      value: v(o?.maintenance.open),
      unit: t("maintenanceUnit"),
      attention: (o?.maintenance.open ?? 0) > 0,
      note: unavailable,
      facts: o
        ? [
            { label: t("maintenanceInProgress"), value: o.maintenance.inProgress, tone: "active" },
            {
              label: t("maintenanceUrgent"),
              value: o.maintenance.urgent,
              tone: o.maintenance.urgent ? "bad" : "idle",
            },
          ]
        : [],
      series: o
        ? {
            values: o.series.tickets,
            caption,
            label: t("maintenanceSeries", { total: sum(o.series.tickets), today: o.series.tickets.at(-1) ?? 0 }),
          }
        : undefined,
    },
    corrections: {
      icon: <Flag />,
      value: v(o?.corrections.open),
      unit: t("correctionsUnit"),
      attention: (o?.corrections.open ?? 0) > 0,
      note: unavailable,
      series: o
        ? { values: o.series.corrections, caption, label: t("correctionsSeries", { total: sum(o.series.corrections) }) }
        : undefined,
    },
    projects: {
      icon: <GalleryVerticalEnd />,
      value: v(o?.projects.waiting),
      unit: t("projectsUnit"),
      attention: (o?.projects.waiting ?? 0) > 0,
      note: unavailable,
      facts: o ? [{ label: t("projectsPublished"), value: o.projects.published }] : [],
    },
    users: {
      icon: <Users />,
      value: v(o?.users.total),
      unit: t("usersUnit"),
      note: unavailable,
      facts: o
        ? [
            { label: t("usersAdmins"), value: o.users.admins },
            { label: t("usersBanned"), value: o.users.banned, tone: o.users.banned ? "warn" : "idle" },
          ]
        : [],
    },
    mirror: {
      icon: <Share2 />,
      value: null,
      unit: t("mirrorUnit"),
      note: !mirror?.connected
        ? t("mirrorNotConnected")
        : mirror.paused
          ? t("mirrorPaused")
          : mirror.lastStatus === "failed"
            ? t("mirrorFailed")
            : t("mirrorConnected"),
    },
  };
}
