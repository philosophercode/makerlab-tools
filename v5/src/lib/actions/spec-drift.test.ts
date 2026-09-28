// @vitest-environment node
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PERMISSIONS } from "../auth/permissions";
import { ACTION_DEFINITIONS } from "./registry";

/**
 * The drift check between the assistant–GUI parity spec and the registry
 * (spec §9 phase 8: "`/drift` finds no gap between §4.9 and the registry"),
 * mechanical so it keeps holding after this branch merges.
 *
 * - **Registry → spec.** Every registered action's id and tool name are
 *   written down somewhere in the spec (§4.9 or an as-built amendment), so an
 *   action never exists that no document names.
 * - **Spec → registry.** Every action id §4.9 names is registered, or is in
 *   {@link NOT_REGISTERED} with the amendment that decided it.
 * - **MCP exposure.** For every §4.9 row that names registered ids, the
 *   row's MCP column agrees with each definition's `mcp`, or the difference is
 *   in {@link MCP_DEVIATIONS} with the amendment that made it.
 *
 * The spec lives beside `v5/` today and at the repository root after the
 * flatten (PR #79); both places are looked for.
 */

const SPEC_NAME = "2026-09-27-assistant-gui-parity-design.md";
const HERE = fileURLToPath(new URL(".", import.meta.url));
const APP = join(HERE, "..", "..", "..");
const SPEC_PATH = [join(APP, "..", "docs", "specs", SPEC_NAME), join(APP, "docs", "specs", SPEC_NAME)].find((path) => existsSync(path));

/** §4.9 ids that are deliberately not registered, and where that was decided. */
const NOT_REGISTERED: Record<string, string> = {
  "projects.submit": "phases 7–8 amendment: never through the assistant (a student's write-up with uploads)",
  "account.revoke_token": "phases 7–8 amendment: an account gate, not an admin permission",
  "catalog.refresh_cache": "phases 7–8 amendment: a cache flush, not a change",
  "pending.approve_draft": "phases 4–6 amendment: one action, pending.approve with `publish`",
  "tools.publish": "phases 4–6 amendment, deviation 1: one action, tools.set_published",
  "tools.unpublish": "phases 4–6 amendment, deviation 1: one action, tools.set_published",
  "refresh.decide": "§4.9: never — the review surface for research proposals",
  "mirror.create_databases": "§4.9: never — a mapping is a form, not a sentence",
  "mirror.save_mapping": "§4.9: never — a mapping is a form, not a sentence",
};

/** Registered actions whose MCP exposure differs from §4.9's column, and why. */
const MCP_DEVIATIONS: Record<string, string> = {
  "corrections.set_status": "phase 1 amendment, deviation 11: no `act` scope (§11 answer 4), so it proposes",
};

function section49(spec: string): string {
  const start = spec.indexOf("### 4.9 The target, per action");
  const end = spec.indexOf("## 5. Behavior / flow", start);
  if (start < 0 || end < 0) throw new Error("the spec has no §4.9 table");
  return spec.slice(start, end);
}

interface SpecRow {
  ids: string[];
  mcp: "never" | "propose" | "direct" | null;
}

function specRows(table: string): SpecRow[] {
  return table
    .split("\n")
    .filter((line) => line.startsWith("| ") && !line.startsWith("| #") && !line.startsWith("|---"))
    .map((line) => {
      const cells = line.split(" | ");
      // A permission named in the cell ("any `maintenance.manage` holder") is not an action.
      const ids = [...(cells[1] ?? "").matchAll(/`([a-z]+\.[a-z_]+)`/g)].map((m) => m[1]).filter((id) => !(PERMISSIONS as string[]).includes(id));
      const mcp = (cells[4] ?? "").match(/\b(never|propose|direct)\b/)?.[1] as SpecRow["mcp"] | undefined;
      return { ids, mcp: mcp ?? null };
    })
    .filter((row) => row.ids.length > 0);
}

describe.skipIf(!SPEC_PATH)("the parity spec and the registry agree (§9 phase 8)", () => {
  const spec = SPEC_PATH ? readFileSync(SPEC_PATH, "utf8") : "";
  const rows = SPEC_PATH ? specRows(section49(spec)) : [];

  it("finds the §4.9 table (a parser that finds nothing checks nothing)", () => {
    expect(rows.length).toBeGreaterThan(20);
  });

  it("writes down every registered action's id and tool name", () => {
    const missing = ACTION_DEFINITIONS.flatMap((def) => [def.id, def.toolName].filter((name) => !spec.includes(`\`${name}\``)));
    expect(missing).toEqual([]);
  });

  it("registers every action §4.9 names, or says where it was decided not to", () => {
    const registered = new Set(ACTION_DEFINITIONS.map((def) => def.id));
    const missing = rows.flatMap((row) => row.ids).filter((id) => !registered.has(id) && !(id in NOT_REGISTERED));
    expect(missing).toEqual([]);
    // And the list of decisions holds nothing that has since been registered.
    expect(Object.keys(NOT_REGISTERED).filter((id) => registered.has(id))).toEqual([]);
  });

  it("exposes each action over MCP as §4.9 says, or as an amendment changed it", () => {
    const byId = new Map(ACTION_DEFINITIONS.map((def) => [def.id, def]));
    const drift = rows.flatMap((row) =>
      row.ids
        .filter((id) => byId.has(id) && row.mcp && !(id in MCP_DEVIATIONS))
        .filter((id) => byId.get(id)!.mcp !== row.mcp)
        .map((id) => `${id}: spec ${row.mcp}, registry ${byId.get(id)!.mcp}`)
    );
    expect(drift).toEqual([]);
    for (const id of Object.keys(MCP_DEVIATIONS)) expect(byId.has(id), id).toBe(true);
  });
});
