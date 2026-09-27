"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef } from "@tanstack/react-table";
import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type {
  AdminActionError,
  AdminActionResult,
  RemoveUserAction,
  RemoveUserResult,
  SetTitleAction,
} from "../../app/admin/users/action-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "../system/data-table/DataTable";
import { FilterBar } from "../system/data-table/FilterBar";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { facetOptions } from "../system/data-table/facet-options";
import { EmptyState } from "../system/EmptyState";
import { RemoveUserControl } from "./RemoveUserControl";
import { RoleSelect } from "./RoleSelect";
import { TitleEditor } from "./TitleEditor";
import {
  NO_USER_FILTERS,
  matchesUserFilters,
  userFiltersToSearchParams,
  type UserFilterState,
} from "./users-filters";

/**
 * The roster on `/admin/users` as a `DataTable` (UI system spec §7.2): **one
 * row per person, one thing per column** — Person (name, a YOU badge, the
 * address under it in small mono), Title (the title and a pencil that edits
 * it inline, `TitleEditor`), Role (the select), First signed in (an ISO date,
 * or "Not signed in yet" for somebody added ahead of time) and Account
 * (**Remove**). `UsersTable` has already worked out which rows cannot change
 * and why; the controls say so with a short badge whose tooltip has the full
 * reason (`LockNote`). On a phone each person is a compact list item with the
 * same controls.
 *
 * **Role and title are different things, and the table keeps them apart.** The
 * Role column is authorization only ("User", "Admin", "Super admin"); the
 * Title column is what the person is called ("Director", "Supermaker",
 * "Student"…), which grants nothing.
 *
 * Search (name, address, custom title) and the Role facet narrow the list in
 * the browser and are written to the URL, as on the inventory, so "every
 * super admin" is a link.
 *
 * A removal takes the row off at once and says so in a status line above the
 * table (auth spec amendment 2026-09-25); the server re-renders the page too,
 * but the roster does not wait for that to stop showing somebody who is gone.
 */

export interface RosterRow {
  id: string;
  /** What to call them: the stored name, which is the address until they sign in if nobody typed one. */
  name: string;
  email: string;
  role: Role;
  /** The stored custom title, or null for the role's default. */
  title: string | null;
  /** The first sign-in as an ISO date, or null when they have not signed in yet. */
  joined: string | null;
  isSelf: boolean;
  roleLockedReason: AdminActionError | null;
  removeLockedReason: AdminActionError | null;
}

export interface UsersRosterProps {
  rows: RosterRow[];
  initial?: UserFilterState;
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  removeUser: RemoveUserAction;
  setTitle: SetTitleAction;
}

type Removed = Extract<RemoveUserResult, { ok: true }>;

const SEARCH_KEYS = ["name", "email", (row: RosterRow) => row.title ?? ""];

export function UsersRoster({ rows, initial = NO_USER_FILTERS, setRole, removeUser, setTitle }: UsersRosterProps) {
  const t = useTranslations("admin");
  const [filters, setFilters] = useState<UserFilterState>(initial);
  const [removedIds, setRemovedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [lastRemoved, setLastRemoved] = useState<Removed | null>(null);

  useEffect(() => {
    const query = userFiltersToSearchParams(filters).toString();
    // Only once somebody has filtered: an untouched roster leaves the URL alone.
    if (query || window.location.search) {
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }
  }, [filters]);

  const present = useMemo(() => rows.filter((row) => !removedIds.has(row.id)), [rows, removedIds]);

  const visible = useMemo(() => {
    const faceted = present.filter((row) => matchesUserFilters(row, filters));
    const query = filters.query.trim();
    return query ? matchSorter(faceted, query, { keys: SEARCH_KEYS }) : faceted;
  }, [present, filters]);

  const roleFacet = useMemo(
    () =>
      facetOptions(
        present.filter((row) => matchesUserFilters(row, { ...filters, role: null })),
        ROLES,
        (row, v) => row.role === v,
        (v) => t(`roles.${v}`)
      ),
    [present, filters, t]
  );

  const columns = useMemo<ColumnDef<RosterRow, unknown>[]>(() => {
    const onRemoved = (result: Removed) => {
      setRemovedIds((current) => new Set(current).add(result.removed.id));
      setLastRemoved(result);
    };
    return [
      {
        id: "person",
        accessorFn: (row) => row.name,
        header: t("columnPerson"),
        enableHiding: false,
        meta: { rowHeader: true, className: "min-w-[14rem] whitespace-normal" },
        cell: ({ row }) => <Person row={row.original} />,
      },
      {
        id: "title",
        accessorFn: (row) => row.title ?? "",
        header: t("columnTitle"),
        meta: { className: "min-w-[10rem] whitespace-normal" },
        cell: ({ row }) => (
          <TitleEditor
            userId={row.original.id}
            personName={row.original.name}
            role={row.original.role}
            title={row.original.title}
            action={setTitle}
          />
        ),
      },
      {
        id: "role",
        accessorFn: (row) => ROLES.indexOf(row.role),
        header: t("columnRole"),
        cell: ({ row }) => (
          <RoleSelect
            userId={row.original.id}
            personName={row.original.name}
            role={row.original.role}
            disabledReason={row.original.roleLockedReason}
            action={setRole}
          />
        ),
      },
      {
        id: "joined",
        // Not signed in yet sorts before the earliest date.
        accessorFn: (row) => row.joined ?? "",
        header: t("columnJoined"),
        meta: { align: "right" },
        cell: ({ row }) => <Joined joined={row.original.joined} />,
      },
      {
        id: "account",
        header: t("columnAccount"),
        enableSorting: false,
        meta: { className: "whitespace-normal" },
        cell: ({ row }) => (
          <RemoveUserControl
            userId={row.original.id}
            personName={row.original.name}
            email={row.original.email}
            disabledReason={row.original.removeLockedReason}
            action={removeUser}
            onRemoved={onRemoved}
          />
        ),
      },
    ];
  }, [t, setRole, removeUser, setTitle]);

  const active = Boolean(userFiltersToSearchParams(filters).toString());
  const clear = () => setFilters(NO_USER_FILTERS);

  return (
    <>
      <p role="status" className="m-0 text-sm empty:hidden">
        {lastRemoved
          ? lastRemoved.blocked
            ? t("removedBlockedNotice", { name: lastRemoved.removed.name, email: lastRemoved.removed.email })
            : t("removedNotice", { name: lastRemoved.removed.name })
          : null}
      </p>
      {present.length > 0 ? (
        <FilterBar
          label={t("users.filtersLabel")}
          search={{
            value: filters.query,
            onChange: (query) => setFilters((current) => ({ ...current, query })),
            label: t("users.search"),
            placeholder: t("users.searchPlaceholder"),
          }}
          facets={
            <FacetFilter
              label={t("columnRole")}
              value={filters.role}
              options={roleFacet}
              onChange={(role) => setFilters((current) => ({ ...current, role: role as Role | null }))}
            />
          }
          shown={visible.length}
          total={present.length}
          onClear={active ? clear : null}
        />
      ) : null}
      <DataTable
        data={visible}
        columns={columns}
        getRowId={getRowId}
        getRowName={getRowName}
        labels={{ table: t("tableLabel") }}
        keyboardHint={false}
        empty={
          // Spec §6: an empty state names what is missing and what would change
          // it. With no rows at all, nobody has ever signed in — on a fresh
          // deployment the normal first state rather than a fault.
          present.length === 0 ? (
            <EmptyState>{t("noUsers")}</EmptyState>
          ) : (
            <EmptyState action={<Button onClick={clear}>{t("inventory.clearFilters")}</Button>}>
              {t("users.emptyFiltered")}
            </EmptyState>
          )
        }
        mobileRow={(row) => (
          <div className="flex flex-col gap-1.5 px-1 py-2">
            <div className="flex items-start justify-between gap-3">
              <Person row={row} />
              <Joined joined={row.joined} />
            </div>
            <TitleEditor userId={row.id} personName={row.name} role={row.role} title={row.title} action={setTitle} />
            <div className="flex flex-wrap items-start gap-2">
              <RoleSelect
                userId={row.id}
                personName={row.name}
                role={row.role}
                disabledReason={row.roleLockedReason}
                action={setRole}
              />
              <RemoveUserControl
                userId={row.id}
                personName={row.name}
                email={row.email}
                disabledReason={row.removeLockedReason}
                action={removeUser}
                onRemoved={(result) => {
                  setRemovedIds((current) => new Set(current).add(result.removed.id));
                  setLastRemoved(result);
                }}
              />
            </div>
          </div>
        )}
      />
    </>
  );
}

const getRowId = (row: RosterRow) => row.id;
const getRowName = (row: RosterRow) => row.name;

/** Name and YOU on one line, the address under it — small, mono, muted. */
function Person({ row }: { row: RosterRow }) {
  const t = useTranslations("admin");
  // Added without a name: the address *is* the name until Google supplies one,
  // so it is said once rather than twice.
  const nameIsAddress = row.name === row.email;
  return (
    <span className="flex min-w-0 flex-col leading-tight">
      <span className="flex items-center gap-2">
        <span className={nameIsAddress ? "font-mono text-xs" : "font-medium"}>{row.name}</span>
        {row.isSelf ? <Badge variant="accent">{t("you")}</Badge> : null}
      </span>
      {/* The one surface in the app that shows an address: telling two
          accounts apart is the whole job here (spec §8). Mono: an identifier. */}
      {nameIsAddress ? null : (
        <span className="truncate font-mono text-xs text-muted-foreground">{row.email}</span>
      )}
    </span>
  );
}

/** The first sign-in, or — for somebody added ahead of time — that there has not been one. */
function Joined({ joined }: { joined: string | null }) {
  const t = useTranslations("admin");
  if (joined) return <span className="font-mono text-xs tabular-nums">{joined}</span>;
  return <span className="text-xs whitespace-nowrap text-muted-foreground">{t("notSignedIn")}</span>;
}
