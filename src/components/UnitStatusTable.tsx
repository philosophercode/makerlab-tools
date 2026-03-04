"use client";

import { useState } from "react";
import type { UnitRecord } from "@/lib/types";

const STATUS_COLORS: Record<string, string> = {
  Available: "bg-success/10 text-success",
  "In Use": "bg-warning/10 text-warning",
  "Under Maintenance": "bg-primary/10 text-primary",
  "Out of Service": "bg-danger/10 text-danger",
  Retired: "bg-muted-bg text-muted",
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

export default function UnitStatusTable({ units }: { units: UnitRecord[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (units.length === 0) return null;

  const toggle = (id: string) =>
    setExpandedId((prev) => (prev === id ? null : id));

  return (
    <div className="space-y-2">
      <h2 className="text-sm font-medium text-muted">
        Units ({units.length})
      </h2>
      <div className="overflow-x-auto rounded-lg border border-card-border">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-card-border bg-muted-bg/50">
              <th
                scope="col"
                className="px-3 py-2 text-left font-medium text-muted"
              >
                Unit
              </th>
              <th
                scope="col"
                className="px-3 py-2 text-left font-medium text-muted"
              >
                Status
              </th>
              <th
                scope="col"
                className="hidden sm:table-cell px-3 py-2 text-left font-medium text-muted"
              >
                Condition
              </th>
              <th scope="col" className="w-8 px-3 py-2">
                <span className="sr-only">Expand</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {units.map((unit) => {
              const isExpanded = expandedId === unit.id;
              const { fields } = unit;
              const hasDetails =
                fields.serial_number ||
                fields.asset_tag ||
                fields.date_acquired ||
                fields.notes;

              return (
                <tr
                  key={unit.id}
                  className="border-b border-card-border last:border-0"
                >
                  <td colSpan={4} className="p-0">
                    {/* Summary row */}
                    <button
                      type="button"
                      onClick={() => toggle(unit.id)}
                      className="flex w-full items-center text-left hover:bg-muted-bg/30 transition-colors"
                    >
                      <span className="flex-1 px-3 py-2 font-medium">
                        {fields.unit_label}
                      </span>
                      <span className="px-3 py-2">
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
                            STATUS_COLORS[fields.status || ""] ||
                            "bg-muted-bg text-muted"
                          }`}
                        >
                          {fields.status || "Unknown"}
                        </span>
                      </span>
                      <span className="hidden sm:inline px-3 py-2 text-muted">
                        {fields.condition || "—"}
                      </span>
                      <span className="px-3 py-2 text-muted">
                        <svg
                          className={`h-4 w-4 transition-transform ${
                            isExpanded ? "rotate-180" : ""
                          }`}
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M19 9l-7 7-7-7"
                          />
                        </svg>
                      </span>
                    </button>

                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="border-t border-card-border bg-muted-bg/20 px-3 py-3 space-y-2">
                        {/* Condition (shown here on mobile since hidden in header) */}
                        <div className="sm:hidden">
                          <span className="text-xs font-medium text-muted">
                            Condition
                          </span>
                          <p className="text-sm">
                            {fields.condition || "Unknown"}
                          </p>
                        </div>

                        {fields.serial_number && (
                          <div>
                            <span className="text-xs font-medium text-muted">
                              Serial Number
                            </span>
                            <p className="text-sm">{fields.serial_number}</p>
                          </div>
                        )}

                        {fields.asset_tag && (
                          <div>
                            <span className="text-xs font-medium text-muted">
                              Asset Tag
                            </span>
                            <p className="text-sm">{fields.asset_tag}</p>
                          </div>
                        )}

                        {fields.date_acquired && (
                          <div>
                            <span className="text-xs font-medium text-muted">
                              Date Acquired
                            </span>
                            <p className="text-sm">
                              {formatDate(fields.date_acquired)}
                            </p>
                          </div>
                        )}

                        {fields.notes && (
                          <div>
                            <span className="text-xs font-medium text-muted">
                              Notes
                            </span>
                            <p className="text-sm text-muted whitespace-pre-wrap">
                              {fields.notes}
                            </p>
                          </div>
                        )}

                        {!hasDetails && (
                          <p className="text-xs text-muted">
                            No additional details available.
                          </p>
                        )}

                        <a
                          href={`/units/${unit.id}`}
                          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
                        >
                          View full unit page
                          <svg
                            className="h-3 w-3"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M9 5l7 7-7 7"
                            />
                          </svg>
                        </a>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
