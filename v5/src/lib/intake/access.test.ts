import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Role } from "../auth/roles";
import type { PendingStatus } from "../db/schema/vocabulary";
import {
  canActOnPendingTool,
  hasUnresolvedDuplicate,
  INTAKE_REVIEW_PERMISSION,
  hasStalledStart,
  isResearchable,
} from "./access";

/**
 * Who may act on a pending item, and what may be researched (spec §5.4 step 6).
 *
 * The card, the intake pages and both routes call these same functions, so a
 * row wrong here is wrong on every surface at once.
 */

const OWNER = "user-owner";

describe("canActOnPendingTool", () => {
  it.each<[string, Role | null | undefined, string | null | undefined, boolean]>([
    ["anonymous", "anonymous", null, false],
    ["no identity at all", undefined, undefined, false],
    ["a user, even on their own item", "user", OWNER, false],
    ["an admin on their own item", "admin", OWNER, true],
    ["an admin on somebody else's item (holds tools.approve)", "admin", "someone-else", true],
    ["a super admin on somebody else's item", "super_admin", "someone-else", true],
    ["an admin with no user id", "admin", null, true],
  ])("%s → %s", (_label, role, userId, expected) => {
    expect(canActOnPendingTool({ role, userId }, { createdBy: OWNER })).toBe(expected);
  });

  it("is false for a null subject", () => {
    expect(canActOnPendingTool(null, { createdBy: OWNER })).toBe(false);
  });

  it("gates the review pages on tools.approve", () => {
    expect(INTAKE_REVIEW_PERMISSION).toBe("tools.approve");
  });
});

describe("isResearchable", () => {
  const base = { workflowRunId: null, duplicateResolution: null } as const;

  it.each<[PendingStatus, string | null, boolean]>([
    ["identified", null, true],
    ["researched", null, true],
    ["failed", null, true],
    ["queued", null, true],
    ["queued", "run-1", false],
    ["researching", null, false],
    ["researching", "run-1", false],
    ["approved", null, false],
    ["discarded", null, false],
  ])("%s with run %s → %s", (status, workflowRunId, expected) => {
    expect(isResearchable({ ...base, status, workflowRunId })).toBe(expected);
  });

  it("takes a queued item with no run only once its start has stalled", () => {
    const now = Date.parse("2026-09-23T12:00:00Z");
    const queued = { ...base, status: "queued" as const };
    // A request is between queueing it and start() right now.
    expect(isResearchable({ ...queued, researchRequestedAt: new Date(now - 60_000) }, now)).toBe(false);
    // Five minutes on, nothing started it.
    expect(isResearchable({ ...queued, researchRequestedAt: new Date(now - 5 * 60_000) }, now)).toBe(true);
    // Its start failed and said so.
    expect(
      isResearchable({ ...queued, researchRequestedAt: new Date(now - 1000), researchError: "boom" }, now)
    ).toBe(true);
  });

  it("refuses an item whose duplicate was resolved as discard", () => {
    expect(isResearchable({ ...base, status: "identified", duplicateResolution: "discard" })).toBe(false);
    expect(isResearchable({ ...base, status: "identified", duplicateResolution: "add_unit" })).toBe(true);
    expect(isResearchable({ ...base, status: "identified", duplicateResolution: "new_tool" })).toBe(true);
  });
});

describe("hasUnresolvedDuplicate", () => {
  it.each([
    [{ duplicateOfToolId: "t", duplicateOfPendingId: null, duplicateResolution: null }, true],
    [{ duplicateOfToolId: null, duplicateOfPendingId: "p", duplicateResolution: null }, true],
    [{ duplicateOfToolId: "t", duplicateOfPendingId: null, duplicateResolution: "new_tool" as const }, false],
    [{ duplicateOfToolId: null, duplicateOfPendingId: null, duplicateResolution: null }, false],
  ])("%o → %s", (item, expected) => {
    expect(hasUnresolvedDuplicate(item)).toBe(expected);
  });
});

describe("the intake modules are client-safe", () => {
  // The card and the intake pages are client components, and they import
  // these four. A value import of the database, the auth instance or anything
  // `server-only` would drag it into the browser bundle — so every import
  // here is `import type`, except the permission declaration, which is pure
  // data and already imported by client components, and `./limits`, whose
  // own row below holds it to the same rule.
  it.each(["types.ts", "view.ts", "limits.ts", "access.ts"])("%s imports values only from client-safe modules", (file) => {
    const source = readFileSync(join(process.cwd(), "src/lib/intake", file), "utf8");
    const valueImports = [...source.matchAll(/^import\s+(?!type\b)[^;]*?from\s+"([^"]+)"/gm)].map(
      (match) => match[1]
    );
    expect(
      valueImports.filter((specifier) => specifier !== "../auth/permissions" && specifier !== "./limits")
    ).toEqual([]);
    expect(source).not.toMatch(/server-only/);
  });
});

describe("hasStalledStart", () => {
  const now = Date.parse("2026-09-23T12:00:00Z");
  const fresh = new Date(now - 60_000).toISOString();
  const stale = new Date(now - 10 * 60_000).toISOString();

  it.each<[string, Parameters<typeof hasStalledStart>[0], boolean]>([
    ["a fresh start", { status: "queued", hasWorkflowRun: false, researchRequestedAt: fresh }, false],
    ["a start nobody finished", { status: "queued", hasWorkflowRun: false, researchRequestedAt: stale }, true],
    ["a recorded failure", { status: "queued", hasWorkflowRun: false, researchRequestedAt: fresh, researchError: "x" }, true],
    ["a run that holds it", { status: "queued", hasWorkflowRun: true, researchRequestedAt: stale }, false],
    ["research under way", { status: "researching", hasWorkflowRun: false, researchRequestedAt: stale }, false],
  ])("%s", (_label, item, expected) => {
    expect(hasStalledStart(item, now)).toBe(expected);
  });
});
