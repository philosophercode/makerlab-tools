import { getTranslations } from "next-intl/server";
import { AdminActions } from "../../components/admin/AdminActions";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { tileContent } from "../../components/admin/admin-tiles";
import { RowStatus } from "../../components/admin/RowStatus";
import { EmptyState } from "../../components/system/EmptyState";
import { Tile, TileGroup } from "../../components/system/Tile";
import { ADMIN_GROUPS, surfacesFor } from "../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { isLegacyMcpTokenSet } from "../../lib/auth/mcp-caller";
import { loadAdminOverview } from "../../lib/data/admin-overview";

/**
 * `/admin` — the home: one tile per surface the viewer may open, grouped by
 * the job it serves, each with its live count (UI system spec §8.1; data
 * platform spec §6 `AdminHome`, which this finally builds). It answers "where
 * is the work" before anything is opened.
 *
 * **Honest, as before.** The tiles are `surfacesFor(identity)` — the list the
 * section bar and the palette use, each surface checked with the `can()` its
 * page calls — so nobody follows a tile into a refusal, and only those tiles'
 * counts are read. A count that cannot be read says so; it is never a zero,
 * which would claim there is no work (Article 4). Waiting counts live here
 * and only here (owner decision 2026-09-25: not in the section bar).
 *
 * Four columns, one per job, left to right in the order equipment moves
 * through the lab: small multiples of the same question.
 */

export default async function AdminHomePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const open = surfacesFor(identity);
  const overview = await loadAdminOverview(
    open.map((entry) => entry.count),
    { userId: identity.userId }
  );
  const tiles = open.map((entry) => ({ entry, ...tileContent(entry.key, overview[entry.count] as never, t) }));
  const waiting = tiles.reduce((sum, { content }) => sum + (content.waiting && content.value ? content.value : 0), 0);
  const unreadable = tiles.filter((tile) => tile.unreadable).length;

  return (
    <div className="ui flex flex-col gap-6">
      <AdminPageHeader
        title={t("home.title")}
        lede={t("home.lede")}
        facts={[
          t("home.factsWaiting", { count: waiting }),
          t("home.factsSurfaces", { count: open.length }),
          unreadable > 0 && t("home.factsUnreadable", { count: unreadable }),
        ]}
        actions={<AdminActions role={identity.role} />}
      />

      {/* MCP access spec §5.3: the retired shared secret still works for one
          release, as the public read-only tools only — and says so here. */}
      {isLegacyMcpTokenSet() ? <RowStatus tone="warn">{t("mcpTokenDeprecated")}</RowStatus> : null}

      {open.length === 0 ? <EmptyState>{t("indexNothingYet")}</EmptyState> : null}

      <div className="grid grid-cols-1 gap-x-4 gap-y-8 sm:grid-cols-2 xl:grid-cols-4">
        {ADMIN_GROUPS.map((group) => {
          const members = tiles.filter(({ entry }) => entry.group === group);
          if (members.length === 0) return null;
          return (
            <TileGroup key={group} id={`admin-group-${group}`} title={t(`nav.group.${group}`)}>
              {members.map(({ entry, content }) => {
                const Icon = entry.icon;
                return (
                  <Tile
                    key={entry.key}
                    id={`tile-${entry.key}`}
                    href={entry.href}
                    title={t(`nav.surface.${entry.key}`)}
                    icon={<Icon />}
                    {...content}
                  />
                );
              })}
            </TileGroup>
          );
        })}
      </div>
    </div>
  );
}
