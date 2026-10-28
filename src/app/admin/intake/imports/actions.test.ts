// @vitest-environment node
import { nextCacheMock } from "../../../../../test/mocks/next-cache";
import { nextHeadersMock, setMockHeaders } from "../../../../../test/mocks/next-headers";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("next/headers", () => nextHeadersMock());

/** `start()` for Suggest names — the workflow tier has its own test. */
const wf = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "run-suggest" })) }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../../../workflows/suggest-names", () => ({
  suggestNames: Object.assign(async () => ({ suggested: 0, failed: 0 }), { workflowId: "suggest-names" }),
}));
vi.mock("../../../../workflows/research-batch", () => ({
  researchBatch: Object.assign(async () => ({}), { workflowId: "research-batch" }),
}));
vi.mock("../../../../workflows/import-rows", () => ({
  importRows: Object.assign(async () => ({ slices: 0, done: 0 }), { workflowId: "import-rows" }),
}));
vi.mock("../../../../workflows/import-document", () => ({
  importDocument: Object.assign(async () => ({ items: 0, failedChunks: 0 }), { workflowId: "import-document" }),
}));

import { signInAsNew, type SignedInSession } from "../../../../../test/utils/session";
import { resetAuthForTests } from "../../../../lib/auth/config";
import { setNameSuggestion } from "../../../../lib/data/bulk-imports";
import { countResearchRequestedSince, getPendingTool, listPendingTools } from "../../../../lib/data/pending-tools";
import { driftedFields } from "../../../../lib/actions/staleness";
import { resetDbForTests } from "../../../../lib/db/client";
import { startImport } from "../../../../lib/import/service";
import { IMPORTS_RESEARCH } from "../../../../lib/actions/imports";
import { performAction } from "../../../../lib/actions/perform";
import { resolveIdentityFromHeaders } from "../../../../lib/auth/identity";
import {
  acceptImportSuggestions,
  confirmImportColumns,
  ignoreImportSuggestions,
  loadImport,
  loadImportProgress,
  mergeImportRow,
  removeImportRows,
  requestImportSuggestions,
  setImportRowHints,
  updateImportRow,
} from "./actions";

/**
 * The import page's endpoints (bulk intake spec §5, §8), called directly with
 * no page: `tools.add` and ownership (or `tools.approve`) before anything, row
 * ids that must belong to the import, the duplicate check re-run on a new
 * name, and the Suggest names charge against the research allowance.
 */

const AUTH_SECRET = "admin-imports-test-secret";
let counter = 0;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("AUTH_SUPER_ADMIN_EMAILS", "");
  resetAuthForTests();
  wf.start.mockClear();
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function as(role: "user" | "admin" | "super_admin"): Promise<SignedInSession> {
  counter += 1;
  const session = await signInAsNew({ email: `imports-actions-${counter}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
  setMockHeaders({ cookie: session.cookie });
  return session;
}

/**
 * Six random letters to keep names apart between tests. Letters only: a tag
 * that mixes letters and digits ("a3f9c2") reads as a part number, so every
 * row sharing it would be flagged a duplicate of the others — at random.
 */
const tag = () =>
  Array.from(crypto.getRandomValues(new Uint8Array(6)), (byte) => String.fromCharCode(97 + (byte % 26))).join("");

/** A ready import of `lines`, owned by `owner`. */
async function listImport(owner: SignedInSession, lines: string[]) {
  const started = await startImport({
    userId: owner.user.id,
    text: lines.join("\n"),
    origin: "page",
    startRun: async () => ({ runId: "x" }),
    // Every row written here: the background writer has its own workflow test.
    startRows: async () => {
      throw new Error("written in the request in this test");
    },
  });
  if (!started.ok) throw new Error(started.error);
  const loaded = await loadImport({ importId: started.import.id });
  if (!loaded.ok) throw new Error(loaded.error);
  return { importId: started.import.id, items: loaded.items };
}

// The first sign-in and import pay for PGlite's migrations and the auth
// instance; done here, so no single test's 5 s budget carries them.
beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  await listImport(await as("admin"), [`Warm-up ${tag()}`]);
}, 60_000);

describe("who may act on an import", () => {
  it("refuses a student and an anonymous caller", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Drill ${tag()}`]);
    await as("user");
    expect(await loadImport({ importId })).toEqual({ ok: false, error: "not_permitted" });
    setMockHeaders();
    expect(await loadImport({ importId })).toEqual({ ok: false, error: "not_signed_in" });
  });

  it("lets the owner act, and anybody else only with tools.approve", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Lathe ${tag()}`]);
    expect((await loadImport({ importId })).ok).toBe(true);
    // Another admin holds tools.approve too (admins do today), so they may.
    await as("admin");
    expect((await loadImport({ importId })).ok).toBe(true);
  });

  it("refuses a row id from another import", async () => {
    const owner = await as("admin");
    const first = await listImport(owner, [`Saw ${tag()}`]);
    const second = await listImport(owner, [`Router ${tag()}`]);
    expect(await updateImportRow({ importId: first.importId, id: second.items[0].id, patch: { name: "Renamed" } })).toEqual({
      ok: false,
      error: "not_found",
    });
    expect((await setImportRowHints({ importId: first.importId, ids: [second.items[0].id], categoryHint: "Wood" })).ok).toBe(true);
    expect((await getPendingTool(second.items[0].id))?.categoryHint).toBeNull();
  });

  it("refuses an input of the wrong shape", async () => {
    await as("admin");
    expect(await loadImport({ importId: "not-a-uuid" })).toEqual({ ok: false, error: "invalid_field" });
  });
});

describe("the review table's edits", () => {
  it("a new name re-runs the duplicate check against the rest of the import", async () => {
    const owner = await as("admin");
    const name = `Glowforge Pro ${tag()}`;
    const { importId, items } = await listImport(owner, [name, `Mystery box ${tag()}`]);
    const updated = await updateImportRow({ importId, id: items[1].id, patch: { name } });
    expect(updated.ok && updated.items[0].duplicateOf).toMatchObject({ kind: "pending", id: items[0].id });
  });

  it("sets quantity, category and location in bulk, removes and merges", async () => {
    const owner = await as("admin");
    const name = `Clamp ${tag()}`;
    const { importId, items } = await listImport(owner, [name, name, `Vise ${tag()}`]);
    const hints = await setImportRowHints({ importId, ids: items.map((item) => item.id), locationHint: "Wood shop" });
    expect(hints.ok && hints.items.every((item) => item.locationHint === "Wood shop")).toBe(true);

    const merged = await mergeImportRow({ importId, sourceId: items[1].id, targetId: items[0].id });
    expect(merged.ok && merged.items.find((item) => item.id === items[0].id)?.quantity).toBe(2);

    const removed = await removeImportRows({ importId, ids: [items[2].id] });
    expect(removed.ok && removed.items[0].status).toBe("discarded");

    const quantity = await updateImportRow({ importId, id: items[0].id, patch: { quantity: 51 } });
    expect(quantity).toEqual({ ok: false, error: "invalid_field" });
  });

  it("confirms a table's columns and answers the rows", async () => {
    const owner = await as("admin");
    const started = await startImport({ userId: owner.user.id, text: `Item\tQty\nBench grinder ${tag()}\t2`, origin: "page", startRun: async () => ({ runId: "x" }) });
    if (!started.ok) throw new Error(started.error);
    expect(await confirmImportColumns({ importId: started.import.id, columnMap: [null, "quantity"] })).toEqual({ ok: false, error: "no_name" });
    const confirmed = await confirmImportColumns({ importId: started.import.id, columnMap: ["name", "quantity"] });
    expect(confirmed.ok && confirmed.import.status).toBe("ready");
    expect(confirmed.ok && confirmed.items[0].quantity).toBe(2);
  });
});

describe("Suggest names", () => {
  it("charges a quarter item each, starts the pass, and accept renames with the duplicate check", async () => {
    const owner = await as("admin");
    const { importId, items } = await listImport(owner, [`Form 2 ${tag()}`, `Heat gun ${tag()}`, `Epilog ${tag()}`, `Dremel ${tag()}`, `Bandsaw ${tag()}`]);
    const since = new Date(Date.now() - 24 * 60 * 60_000);
    const before = await countResearchRequestedSince(owner.user.id, since);

    const requested = await requestImportSuggestions({ importId, ids: items.map((item) => item.id) });
    expect(requested).toEqual({ ok: true, requested: 5 });
    expect(await countResearchRequestedSince(owner.user.id, since)).toBe(before + 2);
    expect(wf.start).toHaveBeenCalledWith(expect.anything(), [expect.any(String), items.map((item) => item.id)]);

    const suggestion = { canonicalName: `Formlabs Form 2 ${tag()}`, brand: "Formlabs", confidence: "exact" as const, sourceUrl: null, suggestedAt: new Date().toISOString() };
    await setNameSuggestion(items[0].id, suggestion);
    await setNameSuggestion(items[1].id, { ...suggestion, canonicalName: "Drill master heat gun", brand: null, confidence: "likely" });

    const accepted = await acceptImportSuggestions({ importId, ids: [items[0].id] });
    expect(accepted.ok && accepted.items[0]).toMatchObject({ name: suggestion.canonicalName, brand: "Formlabs", nameSuggestion: null });

    const ignored = await ignoreImportSuggestions({ importId, ids: [items[1].id] });
    expect(ignored.ok && ignored.items[0]).toMatchObject({ name: items[1].name, nameSuggestion: null });
  });

  it("refuses past the day's allowance, with what is left, and starts nothing", async () => {
    const owner = await as("admin");
    const { importId, items } = await listImport(owner, [`Kiln ${tag()}`]);
    // Spend the allowance through the ledger the research route counts.
    const { chargeSuggestionAllowance } = await import("../../../../lib/data/bulk-imports");
    await chargeSuggestionAllowance({ userId: owner.user.id, ledgerRows: 100, limit: 100, since: new Date(0) });
    expect(await requestImportSuggestions({ importId, ids: [items[0].id] })).toEqual({ ok: false, error: "daily_limit", remaining: 0 });
    expect(wf.start).not.toHaveBeenCalled();
  });
});

describe("the progress poll (import progress spec §3.3)", () => {
  it("answers every row first, then only the rows changed since the cursor", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Drill ${tag()}`, `Saw ${tag()}`]);
    const first = await loadImportProgress({ importId });
    if (!first.ok) throw new Error(first.error);
    expect(first.items).toHaveLength(2);
    expect(first.import).toMatchObject({ status: "ready", progress: { total: 2, done: 2 } });

    // A cursor past the overlap: nothing has changed since.
    const later = new Date(Date.now() + 120_000).toISOString();
    const next = await loadImportProgress({ importId, since: later });
    expect(next.ok && next.items).toEqual([]);
  });

  it("refuses a student and a malformed cursor", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Lathe ${tag()}`]);
    expect(await loadImportProgress({ importId, since: "yesterday" })).toEqual({ ok: false, error: "invalid_field" });
    await as("user");
    expect(await loadImportProgress({ importId })).toEqual({ ok: false, error: "not_permitted" });
  });
});

describe("imports.research (import progress spec §3.4)", () => {
  it("researches every row not yet researched, in one start per 25, charged to the person", async () => {
    const owner = await as("admin");
    // A noun no other test imports: "Bench grinder <tag> no.3" was, at random,
    // similar enough to another test's "Bench grinder <tag>" to wait as a
    // possible duplicate.
    const names = Array.from({ length: 30 }, (_, i) => `Pipe threader ${tag()} no.${i + 1}`);
    const { importId } = await listImport(owner, names);
    const result = await performAction(IMPORTS_RESEARCH, { importId }, await resolveIdentityFromHeaders(), { surface: "gui" });
        expect(result).toMatchObject({ ok: true, queued: 30, waiting: 0, undecided: 0 });
    expect(await countResearchRequestedSince(owner.user.id, new Date(Date.now() - 60_000))).toBe(30);
    // Two research runs: 25, then 5.
    expect(wf.start).toHaveBeenCalledTimes(2);
  });

  it("leaves a row with an undecided possible duplicate waiting, and says so when nothing else is left", async () => {
    const owner = await as("admin");
    const name = `Spindle sander ${tag()}`;
    const { importId } = await listImport(owner, [name, name]);
    const result = await performAction(IMPORTS_RESEARCH, { importId }, await resolveIdentityFromHeaders(), { surface: "gui" });
    expect(result).toMatchObject({ ok: true, queued: 1, undecided: 1 });
    const again = await performAction(IMPORTS_RESEARCH, { importId }, await resolveIdentityFromHeaders(), { surface: "gui" });
    expect(again).toMatchObject({ ok: false, error: "unresolved_duplicate" });
  });

  it("binds its card to the rows it named: a different row set is a stale card", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Drum sander ${tag()}`, `Belt sander ${tag()}`]);
    const ctx = { identity: await resolveIdentityFromHeaders() } as never;
    const all = await IMPORTS_RESEARCH.preview!({ importId }, ctx);
    const again = await IMPORTS_RESEARCH.preview!({ importId }, ctx);
    expect(all?.version).toBeTruthy();
    expect(again?.version).toBe(all?.version);

    const rows = await listPendingTools({ importId, limit: null });
    const one = await IMPORTS_RESEARCH.preview!({ importId, ids: [rows[0].id] }, ctx);
    expect(one?.version).not.toBe(all?.version);
    expect(driftedFields(one!, all)).toEqual([expect.objectContaining({ opaque: true })]);
  });

  it("refuses a student", async () => {
    const owner = await as("admin");
    const { importId } = await listImport(owner, [`Jointer ${tag()}`]);
    await as("user");
    const result = await performAction(IMPORTS_RESEARCH, { importId }, await resolveIdentityFromHeaders(), { surface: "gui" });
    expect(result).toMatchObject({ ok: false, error: "not_permitted" });
  });
});
