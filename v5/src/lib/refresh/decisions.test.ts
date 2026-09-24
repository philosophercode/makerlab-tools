// @vitest-environment node
import { nextCacheMock } from "../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
// Both triggers have their own tests and start workflows; here they are only counted.
vi.mock("../mirror/trigger", () => ({ requestMirrorPush: vi.fn(async () => undefined) }));
vi.mock("../manuals/trigger", () => ({ requestManualArchive: vi.fn(async () => undefined) }));

import { eq, sql } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { makePng } from "../../../test/gateway/png";
import { server } from "../../../test/msw/server";
import type { BlobStore } from "../blob";
import { claimRefresh, completeRefresh, getRefresh, getRefreshRowRevision, queueRefreshesWithinAllowance } from "../data/tool-refreshes";
import { createPgliteDb } from "../db/pglite";
import { attachments, researchRequests, resources, toolRefreshes, tools, user } from "../db/schema/index";
import type { Db } from "../db/types";
import { requestManualArchive } from "../manuals/trigger";
import { requestMirrorPush } from "../mirror/trigger";
import { decideRefresh } from "./decisions";
import { researchFixture } from "./fixtures.test-helpers";
import type { FieldProposal } from "./types";

/**
 * Accepting refresh proposals through the editor's save path (refresh research
 * spec §3.3, §10 "Accepting"): the write, the revision check and the conflict,
 * the publish rule on names, accept-all skipping unverified quotes, a resource
 * and a cover landing through their own paths, and the mirror trigger.
 */

let db: Db;
const ADMIN = "decide-admin";
const IMAGE_URL = "https://images.example.com/dc3401.png";

function fakeStore() {
  let n = 0;
  const store = {
    put: vi.fn(),
    putUpload: vi.fn(async (prefix: string, file: File, access: "public" | "private") => {
      n += 1;
      const pathname = `${prefix}${file.name}-${n}`;
      return { pathname, url: `https://store.${access}.blob.test/${pathname}` };
    }),
    copyToPublic: vi.fn(),
    read: vi.fn(async () => null),
    list: vi.fn(async () => []),
    del: vi.fn(async () => undefined),
  };
  return store as typeof store & BlobStore;
}

const verified = [{ quote: "a quote on the page", url: "https://wenproducts.com/dc3401", verified: true }];
const notFound = [{ quote: "not on the page", url: "https://wenproducts.com/dc3401", verified: false }];

const PROPOSALS: FieldProposal[] = [
  { id: "use_restrictions", field: "use_restrictions", kind: "differs", safety: true, current: "Rated for 1-micron filtration.", proposed: "Rated for 1-micron filtration.\nRated for 5-micron filtration.", added: ["Rated for 5-micron filtration."], citations: verified, decision: "pending" },
  { id: "name", field: "name", kind: "differs", safety: false, current: "WEN air filter", proposed: "WEN DC3401", citations: verified, decision: "pending" },
  { id: "description", field: "description", kind: "differs", safety: false, current: "Short.", proposed: "A three-speed air filtration system.", citations: notFound, decision: "pending" },
  { id: "resource:https://wenproducts.com/dc3401.pdf", field: "resource", kind: "new", safety: false, current: null, proposed: { title: "DC3401 manual", url: "https://wenproducts.com/dc3401.pdf", type: "Manual" }, citations: [], decision: "pending" },
  { id: "cover_photo", field: "cover_photo", kind: "new", safety: false, current: null, proposed: { url: IMAGE_URL, pageUrl: "https://wenproducts.com/dc3401", width: 1200, height: 900 }, citations: [], decision: "pending" },
  { id: "emergency_stop", field: "emergency_stop", kind: "unverified", safety: true, current: null, citations: [], decision: "pending" },
];

let toolId: string;
let refreshId: string;

beforeAll(async () => {
  db = await createPgliteDb();
  await db.insert(user).values({ id: ADMIN, name: "Niti", email: "decide-admin@cornell.edu", role: "admin" });
});

beforeEach(async () => {
  vi.mocked(requestMirrorPush).mockClear();
  vi.mocked(requestManualArchive).mockClear();
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await db.delete(researchRequests);
  await db.delete(toolRefreshes);
  await db.delete(attachments);
  await db.delete(resources);
  await db.delete(tools);
  const [row] = await db
    .insert(tools)
    .values({ name: "WEN air filter", slug: "wen-air-filter", description: "Short.", useRestrictions: "Rated for 1-micron filtration.", published: true })
    .returning({ id: tools.id });
  toolId = row.id;
  const requestId = crypto.randomUUID();
  const queued = await queueRefreshesWithinAllowance(
    [toolId],
    { requestedBy: ADMIN, requestId, limit: 100, since: new Date(0), note: null, includeDescription: false },
    { db }
  );
  if (!queued.ok) throw new Error("unreachable");
  refreshId = queued.queued[0].refreshId;
  await claimRefresh(refreshId, requestId, { db });
  await completeRefresh(refreshId, requestId, researchFixture(), PROPOSALS, { db });
});

async function decide(command: Omit<Parameters<typeof decideRefresh>[0], "refreshId" | "rowRevision">, canPublish = true, store: BlobStore | null = null) {
  const rowRevision = (await getRefreshRowRevision(refreshId, { db }))!;
  return decideRefresh({ refreshId, rowRevision, ...command }, { userId: ADMIN, canPublish, db, store });
}

async function tool() {
  const [row] = await db.select().from(tools).where(eq(tools.id, toolId));
  return row;
}

function decisionOf(id: string) {
  return getRefresh(refreshId, { db }).then((refresh) => refresh?.proposals?.find((p) => p.id === id)?.decision);
}

it("writes an accepted field through the editor path, records it, and asks the mirror to catch up", async () => {
  expect(await decide({ decision: "accept", ids: ["use_restrictions"] })).toEqual({ ok: true, applied: 1 });
  // The lab's line is kept; research's is added beside it.
  expect((await tool()).useRestrictions).toBe("Rated for 1-micron filtration.\nRated for 5-micron filtration.");
  expect((await tool()).updatedBy).toBe(ADMIN);
  expect(await decisionOf("use_restrictions")).toBe("accepted");
  expect(requestMirrorPush).toHaveBeenCalledTimes(1);
  // The next accept writes against the revision this one left.
  expect(await decide({ decision: "accept", ids: ["name"] })).toMatchObject({ ok: true });
  expect((await tool()).name).toBe("WEN DC3401");
});

it("refuses a stale revision as a conflict, writes nothing, and re-bases the cards on the record now", async () => {
  await db.execute(sql`alter table tools disable trigger tools_set_updated_at`);
  await db.execute(sql`update tools set use_restrictions = 'Edited this afternoon.', updated_at = updated_at + interval '1 second'`);
  await db.execute(sql`alter table tools enable trigger tools_set_updated_at`);

  expect(await decide({ decision: "accept", ids: ["use_restrictions"] })).toEqual({ ok: false, error: "conflict" });
  expect((await tool()).useRestrictions).toBe("Edited this afternoon.");
  const card = (await getRefresh(refreshId, { db }))?.proposals?.find((p) => p.id === "use_restrictions");
  // Re-based additively: the lab's new text, with research's line on top — never in its place.
  expect(card).toMatchObject({
    decision: "conflict",
    current: "Edited this afternoon.",
    proposed: "Edited this afternoon.\nRated for 5-micron filtration.",
    added: ["Rated for 5-micron filtration."],
  });
  expect(await decisionOf("name")).toBe("pending");
  expect(requestMirrorPush).not.toHaveBeenCalled();

  // Decided again, against the re-based revision, it lands.
  expect(await decide({ decision: "accept", ids: ["use_restrictions"] })).toMatchObject({ ok: true });
  expect((await tool()).useRestrictions).toBe("Edited this afternoon.\nRated for 5-micron filtration.");
});

it("refuses to rename a published tool for someone without tools.publish", async () => {
  expect(await decide({ decision: "accept", ids: ["name"] }, false)).toEqual({ ok: false, error: "not_permitted" });
  expect((await tool()).name).toBe("WEN air filter");
});

it("refuses a single accept of a proposal whose quotes were not found", async () => {
  expect(await decide({ decision: "accept", ids: ["description"] })).toEqual({ ok: false, error: "unverified_quote" });
});

it("accept all verified skips unverified quotes and not-found fields, and the name without publish permission", async () => {
  server.use(
    http.get("https://images.example.com/*", () =>
      HttpResponse.arrayBuffer(makePng({ width: 800, height: 600, alpha: false }).slice().buffer, { headers: { "content-type": "image/png" } })
    )
  );
  const store = fakeStore();
  const result = await decide({ decision: "accept_all_verified" }, false, store);
  expect(result).toEqual({ ok: true, applied: 3 });
  expect(await decisionOf("use_restrictions")).toBe("accepted");
  expect(await decisionOf("name")).toBe("pending");
  expect(await decisionOf("description")).toBe("pending");
  expect(await decisionOf("emergency_stop")).toBe("pending");

  // The resource landed through the editor's add-resource path, and its manual will be archived.
  const links = await db.select().from(resources).where(eq(resources.toolId, toolId));
  expect(links).toMatchObject([{ title: "DC3401 manual", url: "https://wenproducts.com/dc3401.pdf", type: "Manual" }]);
  expect(requestManualArchive).toHaveBeenCalledWith([links[0].id]);

  // The cover was downloaded now, stored public, and attached as the tool's photo.
  const photos = await db.select().from(attachments).where(eq(attachments.ownerId, toolId));
  expect(photos).toMatchObject([{ ownerType: "tool", access: "public", origin: "research_image", sourceUrl: IMAGE_URL }]);
  expect(store.putUpload).toHaveBeenCalledTimes(1);
});

it("a cover that cannot be stored is a warning on a landed write, never a refusal", async () => {
  const result = await decide({ decision: "accept", ids: ["cover_photo"] }, true, null);
  expect(result).toEqual({ ok: true, applied: 1, warning: "image_not_attached" });
});

it("rejects, and closes the refresh once nothing is left to decide", async () => {
  expect(await decide({ decision: "reject_all" })).toEqual({ ok: true, applied: 0 });
  const refresh = await getRefresh(refreshId, { db });
  expect(refresh).toMatchObject({ status: "decided", decidedBy: ADMIN });
  expect((await tool()).useRestrictions).toBe("Rated for 1-micron filtration.");
});

it("refuses a decision made against an out-of-date page", async () => {
  expect(await decideRefresh({ refreshId, rowRevision: "0", decision: "reject_all" }, { userId: ADMIN, canPublish: true, db })).toEqual({
    ok: false,
    error: "stale_refresh",
  });
});

it("refuses a stored proposal that would replace a lab rule, and accept-all skips it (amendment 2026-09-24)", async () => {
  // Cards stored before the rule: one replaces the lab's restriction, one turns training off.
  const legacy: FieldProposal[] = [
    { id: "use_restrictions", field: "use_restrictions", kind: "differs", safety: true, current: "Rated for 1-micron filtration.", proposed: "Young or inexperienced users must be supervised.", citations: verified, decision: "pending" },
    { id: "training_required", field: "training_required", kind: "differs", safety: true, current: true, proposed: false, citations: verified, decision: "pending" },
  ];
  await db.update(toolRefreshes).set({ proposals: legacy }).where(eq(toolRefreshes.id, refreshId));

  expect(await decide({ decision: "accept", ids: ["use_restrictions"] })).toEqual({ ok: false, error: "replaces_lab_rule" });
  expect(await decide({ decision: "accept", ids: ["training_required"] })).toEqual({ ok: false, error: "replaces_lab_rule" });
  expect(await decide({ decision: "accept_all_verified" })).toEqual({ ok: false, error: "invalid_field" });
  expect((await tool()).useRestrictions).toBe("Rated for 1-micron filtration.");
  expect(requestMirrorPush).not.toHaveBeenCalled();
});
