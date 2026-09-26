import { getTranslations } from "next-intl/server";
import { AdminActions } from "../../components/admin/AdminActions";
import { AdminPageHeader } from "../../components/admin/AdminPageHeader";
import { tileContent } from "../../components/admin/admin-tiles";
import { RowStatus } from "../../components/admin/RowStatus";
import { EmptyState } from "../../components/system/EmptyState";
import { Tile, TileCell, TileGrid, TileGroup, pairHalves } from "../../components/system/Tile";
import { ADMIN_GROUPS, countLoadersFor, surfacesFor } from "../../lib/admin/surfaces";
import { can } from "../../lib/auth/permissions";
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
 * The groups, in the order equipment moves through the lab, are **bands**
 * (owner, 2026-09-25; DESIGN.md §8.2): each spans as many of the grid's four
 * columns as it has cells, so at 1440 the home is Add equipment + Keep data
 * fresh over Queues + People & settings — two rectangular rows of small
 * multiples, every tile in a row the same height. Consecutive half tiles share
 * a cell. Two columns from `sm` (a group is a full-width band), one on a phone,
 * in the same order.
 */

export default async function AdminHomePage() {
  const t = await getTranslations("admin");
  const identity = await resolveIdentityFromHeaders();
  const open = surfacesFor(identity);
  const overview = await loadAdminOverview(countLoadersFor(identity), { userId: identity.userId });
  const tiles = open.map((entry) => {
    // An extra count the viewer may read is its counts or null (failed); one
    // they may not is absent, and the tile says nothing about it.
    const extra = Object.fromEntries(
      (entry.alsoCounts ?? []).filter((also) => can(identity, also.permission)).map((also) => [also.loader, overview[also.loader] ?? null])
    );
    return { entry, ...tileContent(entry.key, overview[entry.count] as never, t, extra) };
  });
  const waiting = tiles.reduce(
    (sum, { content, alsoWaiting }) => sum + (content.waiting && content.value ? content.value : 0) + alsoWaiting,
    0
  );
  const unreadable = tiles.filter((tile) => tile.unreadable).length;

  // Each group's cells: a tile, or two consecutive half tiles sharing one.
  const groups = ADMIN_GROUPS.map((group) => ({
    group,
    cells: pairHalves(
      tiles.filter(({ entry }) => entry.group === group),
      ({ content }) => content.size === "half"
    ),
  })).filter(({ cells }) => cells.length > 0);

  const renderTile = ({ entry, content }: (typeof tiles)[number]) => {
    const Icon = entry.icon;
    return (
      <Tile key={entry.key} id={`tile-${entry.key}`} href={entry.href} title={t(`nav.surface.${entry.key}`)} icon={<Icon />} {...content} />
    );
  };

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

      <TileGrid>
        {groups.map(({ group, cells }) => (
          <TileGroup key={group} id={`admin-group-${group}`} title={t(`nav.group.${group}`)} cells={cells.length}>
            {cells.map((cell, i) => {
              // The last of an odd number of cells spans both columns at two.
              const wide = i === cells.length - 1 && cells.length % 2 === 1;
              return cell.kind === "pair" ? (
                <TileCell key={cell.items[0].entry.key} pair wide={wide}>
                  {cell.items.map(renderTile)}
                </TileCell>
              ) : (
                <TileCell key={cell.item.entry.key} wide={wide}>
                  {renderTile(cell.item)}
                </TileCell>
              );
            })}
          </TileGroup>
        ))}
      </TileGrid>
    </div>
  );
}
