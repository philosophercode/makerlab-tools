"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { matchSorter } from "match-sorter";
import type { ColumnDef } from "@tanstack/react-table";
import { ROLES, type Role } from "../../lib/db/schema/vocabulary";
import type { AdminActionError, AdminActionResult } from "../../app/admin/users/action-result";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DataTable } from "../system/data-table/DataTable";
import { FilterBar } from "../system/data-table/FilterBar";
import { FacetFilter } from "../system/data-table/FacetFilter";
import { facetOptions } from "../system/data-table/facet-options";
import { EmptyState } from "../system/EmptyState";
import { BanToggle } from "./BanToggle";
import { RoleSelect } from "./RoleSelect";
import {
  NO_USER_FILTERS,
  USER_ACCESS,
  matchesUserFilters,
  userFiltersToSearchParams,
  type UserAccess,
  type UserFilterState,
} from "./users-filters";

/**
 * The roster on `/admin/users` as a `DataTable` (UI system spec §7.2): one row
 * per account, the role select and the ban control in their own columns, the
 * first sign-in as an ISO date. `UsersTable` has already worked out which rows
 * cannot change and why; this renders it. On a phone each person is a
 * two-line item with both controls.
 *
 * Search and the Role / Access facets narrow the list in the browser and are
 * written to the URL, as on the inventory, so "every banned account" is a link.
 */

export interface RosterRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  banned: boolean;
  banReason: string | null;
  joined: string;
  isSelf: boolean;
  roleLockedReason: AdminActionError | null;
  banLockedReason: AdminActionError | null;
}

export interface UsersRosterProps {
  rows: RosterRow[];
  initial?: UserFilterState;
  setRole: (input: { userId: string; role: string }) => Promise<AdminActionResult>;
  setBanned: (input: { userId: string; banned: boolean; reason?: string }) => Promise<AdminActionResult>;
}

export function UsersRoster({ rows, initial = NO_USER_FILTERS, setRole, setBanned }: UsersRosterProps) {
  const t = useTranslations("admin");
  const [filters, setFilters] = useState<UserFilterState>(initial);

  useEffect(() => {
    const query = userFiltersToSearchParams(filters).toString();
    // Only once somebody has filtered: an untouched roster leaves the URL alone.
    if (query || window.location.search) {
      window.history.replaceState(null, "", query ? `?${query}` : window.location.pathname);
    }
  }, [filters]);

  const visible = useMemo(() => {
    const faceted = rows.filter((row) => matchesUserFilters(row, filters));
    const query = filters.query.trim();
    return query ? matchSorter(faceted, query, { keys: ["name", "email"] }) : faceted;
  }, [rows, filters]);

  const facets = useMemo(
    () => ({
      role: facetOptions(
        rows.filter((row) => matchesUserFilters(row, { ...filters, role: null })),
        ROLES,
        (row, v) => row.role === v,
        (v) => t(`roles.${v}`)
      ),
      access: facetOptions(
        rows.filter((row) => matchesUserFilters(row, { ...filters, access: null })),
        USER_ACCESS,
        (row, v) => (v === "banned") === row.banned,
        (v) => t(`users.access.${v}`)
      ),
    }),
    [rows, filters, t]
  );

  const columns = useMemo<ColumnDef<RosterRow, unknown>[]>(
    () => [
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
        id: "access",
        accessorFn: (row) => (row.banned ? 1 : 0),
        header: t("columnAccess"),
        meta: { className: "whitespace-normal", cellClassName: "align-top" },
        cell: ({ row }) => <Access row={row.original} setBanned={setBanned} />,
      },
      {
        id: "joined",
        accessorFn: (row) => row.joined,
        header: t("columnJoined"),
        meta: { align: "right", cellClassName: "align-top" },
      },
    ],
    [t, setRole, setBanned]
  );

  const active = Boolean(userFiltersToSearchParams(filters).toString());
  const clear = () => setFilters(NO_USER_FILTERS);

  return (
    <>
      {rows.length > 0 ? (
        <FilterBar
          label={t("users.filtersLabel")}
          search={{
            value: filters.query,
            onChange: (query) => setFilters((current) => ({ ...current, query })),
            label: t("users.search"),
            placeholder: t("users.searchPlaceholder"),
          }}
          facets={
            <>
              <FacetFilter
                label={t("columnRole")}
                value={filters.role}
                options={facets.role}
                onChange={(role) => setFilters((current) => ({ ...current, role: role as Role | null }))}
              />
              <FacetFilter
                label={t("columnAccess")}
                value={filters.access}
                options={facets.access}
                onChange={(access) => setFilters((current) => ({ ...current, access: access as UserAccess | null }))}
              />
            </>
          }
          shown={visible.length}
          total={rows.length}
          onClear={active ? clear : null}
        />
      ) : null}
      <DataTable
        data={visible}
        columns={columns}
        getRowId={getRowId}
        getRowName={getRowName}
        labels={{ table: t("tableLabel") }}
        rowClassName={(row) => (row.banned ? "text-muted-foreground" : undefined)}
        keyboardHint={false}
        empty={
          // Spec §6: an empty state names what is missing and what would change
          // it. With no rows at all, nobody has ever signed in — on a fresh
          // deployment the normal first state rather than a fault.
          rows.length === 0 ? (
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
              <Access row={row} setBanned={setBanned} />
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

function Access({ row, setBanned }: { row: RosterRow; setBanned: UsersRosterProps["setBanned"] }) {
  const t = useTranslations("admin");
  return (
    <div className="flex flex-col gap-1">
      {row.banned ? (
        <p className="text-xs text-bad">{row.banReason ? t("bannedWithReason", { reason: row.banReason }) : t("banned")}</p>
      ) : null}
      <BanToggle
        userId={row.id}
        personName={row.name}
        banned={row.banned}
        disabledReason={row.banLockedReason}
        action={setBanned}
      />
    </div>
  );
}
