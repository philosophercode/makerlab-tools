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
import {
  NO_USER_FILTERS,
  matchesUserFilters,
  userFiltersToSearchParams,
  type UserFilterState,
} from "./users-filters";

/**
 * The roster on `/admin/users` as a `DataTable` (UI system spec §7.2): one row
 * per account, the role select and **Remove** in their own columns, the first
 * sign-in as an ISO date. `UsersTable` has already worked out which rows
 * cannot change and why; this renders it. On a phone each person is a
 * two-line item with both controls.
 *
 * Search and the Role facet narrow the list in the browser and are written to
 * the URL, as on the inventory, so "every director" is a link.
 *
 * A removal takes the row off at once and says so in a status line above the
 * table (auth spec amendment 2026-09-25); the server re-renders the page too,
 * but the roster does not wait for that to stop showing somebody who is gone.
 */

export interface RosterRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  joined: string;
  isSelf: boolean;
  roleLockedReason: AdminActionError | null;
  removeLockedReason: AdminActionError | null;
}

export interface UsersRosterProps {
  rows: RosterRow[];
  initial?: UserFilterState;
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  removeUser: RemoveUserAction;
}

type Removed = Extract<RemoveUserResult, { ok: true }>;

export function UsersRoster({ rows, initial = NO_USER_FILTERS, setRole, removeUser }: UsersRosterProps) {
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
    return query ? matchSorter(faceted, query, { keys: ["name", "email"] }) : faceted;
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
        meta: { rowHeader: true, className: "whitespace-normal", cellClassName: "align-top" },
        cell: ({ row }) => <Person row={row.original} />,
      },
      {
        id: "role",
        accessorFn: (row) => ROLES.indexOf(row.role),
        header: t("columnRole"),
        meta: { cellClassName: "align-top" },
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
        accessorFn: (row) => row.joined,
        header: t("columnJoined"),
        meta: { align: "right", cellClassName: "align-top" },
      },
      {
        id: "account",
        header: t("columnAccount"),
        enableSorting: false,
        meta: { className: "whitespace-normal", cellClassName: "align-top" },
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
  }, [t, setRole, removeUser]);

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
          <div className="flex flex-col gap-2 px-1 py-2.5">
            <Person row={row} />
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

function Person({ row }: { row: RosterRow }) {
  const t = useTranslations("admin");
  return (
    <span className="flex flex-col">
      <span className="flex items-baseline gap-2 font-medium">
        {row.name}
        {row.isSelf ? <Badge variant="accent">{t("you")}</Badge> : null}
      </span>
      {/* The one surface in the app that shows an address: telling two
          accounts apart is the whole job here (spec §8). Mono: an identifier. */}
      <span className="font-mono text-xs text-muted-foreground">{row.email}</span>
    </span>
  );
}
