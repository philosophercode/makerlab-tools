// @vitest-environment node
import { eq, inArray, notInArray } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import type { UIMessageStreamWriter } from "ai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { server } from "../../../test/msw/server";
import { mcpAccessFor } from "../../../test/utils/identities";

vi.mock("next/cache", () => nextCacheMock());

// Promotion copies blobs, and the Blob SDK is never called for real. Its own
// behaviour is covered in `files/promote.test.ts`; here it is a seam whose
// calls are observed. The default stands in for a store that works: it marks
// the rows public the way the real function would.
const promote = vi.hoisted(() => ({
  fn: vi.fn<(ids: string[]) => Promise<{ promoted: number; failed: number; skipped: number }>>(),
}));
vi.mock("../files/promote", () => ({
  promoteAttachmentsToPublic: (ids: string[]) => promote.fn(ids),
}));

// Sharing one photo between items copies its blob (amendment "Many items at
// once"). The real function runs against this file's database with a fake
// store standing in for Blob, so the rows it writes are the real ones.
const share = vi.hoisted(() => ({
  fn: vi.fn<(requests: unknown[], options: Record<string, unknown>) => Promise<{ shared: number; failed: number }>>(),
}));
vi.mock("../files/share-photo", () => ({
  sharePhotosWithItems: (requests: unknown[], options: Record<string, unknown>) => share.fn(requests, options),
}));

// The photo lookups' workflow start (amendment "A photo for a name"): the step
// has its own tests (`intake/found-photo-steps.test.ts`); here the start is a
// seam whose calls are observed.
const wf = vi.hoisted(() => ({ start: vi.fn() }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../workflows/found-photos", () => ({ findFoundPhotos: vi.fn() }));

// `createPendingBatch` is wrapped so one test can make the database go away.
const pendingHook = vi.hoisted(() => ({ failWith: null as null | Error }));
vi.mock("../data/pending-tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../data/pending-tools")>();
  return {
    ...actual,
    createPendingBatch: (...args: Parameters<typeof actual.createPendingBatch>) => {
      if (pendingHook.failWith) return Promise.reject(pendingHook.failWith);
      return actual.createPendingBatch(...args);
    },
  };
});

import { revalidateTag } from "next/cache";
import type { Identity } from "../auth/identity";
import { DbUnavailableError, getDb, resetDbForTests } from "../db/client";
import { DEMO_ACCOUNTS, DEMO_PENDING } from "../db/demo-seed";
import {
  attachments,
  categories,
  categoryProposals,
  locations,
  pendingTools,
  researchRequests,
  resources,
  tools,
  units,
} from "../db/schema/index";
import { IDENTIFY_MAX_ITEMS, IDENTIFY_MAX_MODEL_NAME_SEARCHES } from "../intake/limits";
import type { IntakeTablePayload } from "../intake/types";
import { toAiTools } from "./chat-adapter";
import { intake, splitCandidateNames } from "./intake";
import { registerAll } from "./mcp-adapter";
import type { CapabilityCtx, CapabilityTool, ToolCandidate } from "./types";

/**
 * Intake, as Phase 6 left it: `identify_tools` in the chat writes pending rows
 * and nothing else, and `create_tool` is an MCP-only Postgres draft. Both run
 * against the demo-seeded PGlite database with no environment variables; the
 * only network is link verification, stubbed with MSW.
 */

const DEMO_PENDING_IDS = Object.values(DEMO_PENDING).map((item) => item.id);

function toolByName(name: string): CapabilityTool<unknown, unknown> {
  const found = intake.tools.find((t) => t.name === name);
  if (!found) throw new Error(`no intake tool named ${name}`);
  return found;
}

const identify = toolByName("identify_tools");
const createTool = toolByName("create_tool");

/** The demo admin, as `resolveIdentity` returns them from a session. */
function admin(): Identity {
  const account = DEMO_ACCOUNTS.admin;
  return {
    role: "admin",
    userId: account.id,
    email: account.email,
    name: account.name,
    rateLimitKey: `user:${account.id}`,
  };
}

function fakeWriter() {
  const writer = { write: vi.fn(), merge: vi.fn(), onError: undefined };
  return writer as typeof writer & UIMessageStreamWriter;
}

function ctx(over: Partial<CapabilityCtx> = {}): CapabilityCtx {
  return { identity: admin(), writer: fakeWriter(), attachments: [], ...over };
}

function photo(attachmentId: string, name = "photo.jpg") {
  return { attachmentId, name, contentType: "image/jpeg" };
}

/** An unowned private upload, as `POST /api/uploads` leaves one for chat — by the demo admin unless said otherwise. */
async function upload(uploadedBy: string | null = DEMO_ACCOUNTS.admin.id): Promise<string> {
  const db = await getDb();
  const [row] = await db
    .insert(attachments)
    .values({ blobPathname: `uploads/chat/${crypto.randomUUID()}.jpg`, access: "private", uploadedBy })
    .returning({ id: attachments.id });
  return row.id;
}

async function attachmentRow(id: string) {
  const db = await getDb();
  const [row] = await db.select().from(attachments).where(eq(attachments.id, id));
  return row;
}

interface IdentifyResult {
  card_rendered: boolean;
  batchId: string;
  items: { id: string; name: string; quantity: number; certainty: string | null; duplicateOf: { kind: string; name: string } | null }[];
  mergedEntries?: number;
  photoSearch?: { searching: number; skippedOverCap?: number; skippedForAllowance?: number; startFailed?: true };
  warnings: string[];
  error?: string;
}

async function runIdentify(
  items: Record<string, unknown>[],
  context: CapabilityCtx = ctx()
): Promise<IdentifyResult> {
  // Parsed the way both adapters parse it, so defaults and trimming apply.
  return (await identify.run(identify.inputSchema.parse({ items }), context)) as IdentifyResult;
}

/** The one `data-intake-table` part a run wrote. */
function writtenPayload(context: CapabilityCtx): IntakeTablePayload {
  const write = (context.writer as ReturnType<typeof fakeWriter>).write;
  expect(write).toHaveBeenCalledTimes(1);
  const [part] = write.mock.calls[0];
  expect(part.type).toBe("data-intake-table");
  return part.data as IntakeTablePayload;
}

beforeAll(() => {
  // A fresh demo database for this file, whatever ran before it in the worker.
  resetDbForTests();
});

/** A Blob store that copies by renaming, for the real `sharePhotosWithItems`. */
function copyingStore() {
  return {
    put: vi.fn(),
    putUpload: vi.fn(),
    read: vi.fn(),
    list: vi.fn().mockResolvedValue([]),
    del: vi.fn().mockResolvedValue(undefined),
    copyToPublic: vi.fn(async (pathname: string, prefix: string) => {
      const name = `${pathname.slice(pathname.lastIndexOf("/") + 1)}-copy-${crypto.randomUUID().slice(0, 6)}`;
      return { pathname: `${prefix}${name}`, url: `https://store.public.blob.vercel-storage.com/${prefix}${name}` };
    }),
  };
}

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  pendingHook.failWith = null;
  wf.start.mockReset();
  wf.start.mockResolvedValue({ runId: "wrun_photos" });
  share.fn.mockReset().mockImplementation(async (requests, options) => {
    const actual = await vi.importActual<typeof import("../files/share-photo")>("../files/share-photo");
    return actual.sharePhotosWithItems(requests as Parameters<typeof actual.sharePhotosWithItems>[0], {
      ...(options as unknown as Parameters<typeof actual.sharePhotosWithItems>[1]),
      store: copyingStore() as unknown as import("../blob").BlobStore,
    });
  });
  promote.fn.mockReset().mockImplementation(async (ids) => {
    const db = await getDb();
    for (const id of ids) {
      await db
        .update(attachments)
        .set({ access: "public", publicUrl: `https://store.public.blob.vercel-storage.com/${id}.jpg` })
        .where(eq(attachments.id, id));
    }
    return { promoted: ids.length, failed: 0, skipped: 0 };
  });
});

afterEach(async () => {
  // Every row these tests made, so a name used twice is never its own duplicate.
  const db = await getDb();
  await db.delete(pendingTools).where(notInArray(pendingTools.id, DEMO_PENDING_IDS));
});

afterAll(() => {
  resetDbForTests();
});

// ── identify_tools ─────────────────────────────────────────────────

describe("identify_tools — the rows it writes", () => {
  it("creates identified rows owned by the caller, all in one batch", async () => {
    const result = await runIdentify([
      { name: "Zorbex Filament Extruder 9000", brand: "Zorbex", categoryHint: "Extrusion" },
      { name: "Quillon Bench Grinder QB-6", serialNumber: "QB6-0042" },
    ]);

    expect(result.items).toHaveLength(2);
    const db = await getDb();
    const rows = await db
      .select()
      .from(pendingTools)
      .where(inArray(pendingTools.id, result.items.map((item) => item.id)));

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("identified");
      expect(row.createdBy).toBe(DEMO_ACCOUNTS.admin.id);
      expect(row.batchId).toBe(result.batchId);
      expect(row.research).toBeNull();
    }
    const extruder = rows.find((row) => row.name === "Zorbex Filament Extruder 9000");
    expect(extruder?.brand).toBe("Zorbex");
    expect(extruder?.categoryHint).toBe("Extrusion");
    expect(rows.find((row) => row.name === "Quillon Bench Grinder QB-6")?.serialNumber).toBe(
      "QB6-0042"
    );
  });

  it("claims only this turn's photos, ignoring an id from anywhere else", async () => {
    const mine = await upload();
    const elsewhere = await upload();

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000", attachmentIds: [mine, elsewhere] }],
      ctx({ attachments: [photo(mine)] })
    );

    const [item] = result.items;
    expect((await attachmentRow(mine)).ownerId).toBe(item.id);
    expect((await attachmentRow(mine)).ownerType).toBe("pending_tool");
    // Not in ctx.attachments: never claimed, whatever the model said.
    expect((await attachmentRow(elsewhere)).ownerId).toBeNull();
  });

  it("gives a lone item that names no photos every photo in the turn", async () => {
    const front = await upload();
    const plate = await upload();

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000" }],
      ctx({ attachments: [photo(front, "front.jpg"), photo(plate, "plate.jpg")] })
    );

    const [item] = result.items;
    expect((await attachmentRow(front)).ownerId).toBe(item.id);
    expect((await attachmentRow(plate)).ownerId).toBe(item.id);
  });

  it("gives one photo of several things to every item when none names it (amendment \"Many items at once\")", async () => {
    const bench = await upload();

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000" }, { name: "Quillon Bench Grinder QB-6" }],
      ctx({ attachments: [photo(bench)] })
    );

    // The first item claims the upload; the second gets its own copy.
    expect((await attachmentRow(bench)).ownerId).toBe(result.items[0].id);
    const db = await getDb();
    const copies = await db.select().from(attachments).where(eq(attachments.ownerId, result.items[1].id));
    expect(copies).toHaveLength(1);
    expect(result.warnings).toEqual([]);
  });

  it("does not guess between several photos and several items, and says one went unused", async () => {
    const [front, side] = [await upload(), await upload()];

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000" }, { name: "Quillon Bench Grinder QB-6" }],
      ctx({ attachments: [photo(front), photo(side)] })
    );

    expect((await attachmentRow(front)).ownerId).toBeNull();
    expect((await attachmentRow(side)).ownerId).toBeNull();
    expect(result.warnings).toContain("photos_unassigned");
  });

  it("says so when the model maps some of the turn's photos to no item", async () => {
    const [a, b, stray] = [await upload(), await upload(), await upload()];

    const result = await runIdentify(
      [
        { name: "Zorbex Filament Extruder 9000", attachmentIds: [a] },
        { name: "Quillon Bench Grinder QB-6", attachmentIds: [b] },
      ],
      ctx({ attachments: [photo(a), photo(b), photo(stray)] })
    );

    expect((await attachmentRow(a)).ownerId).toBe(result.items[0].id);
    expect((await attachmentRow(stray)).ownerId).toBeNull();
    expect(result.warnings).toContain("photos_unassigned");
  });

  it("never claims somebody else's upload, even when its id is in the message", async () => {
    const theirs = await upload(DEMO_ACCOUNTS.user.id);

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000", attachmentIds: [theirs] }],
      ctx({ attachments: [photo(theirs)] })
    );

    const row = await attachmentRow(theirs);
    expect(row.ownerId).toBeNull();
    expect(row.access).toBe("private");
    expect(result.warnings).toContain("photos_not_attached");
  });

  it("takes at most IDENTIFY_MAX_ITEMS items and no blank names", () => {
    const many = Array.from({ length: IDENTIFY_MAX_ITEMS + 1 }, (_, i) => ({ name: `Item ${i}` }));
    expect(identify.inputSchema.safeParse({ items: many }).success).toBe(false);
    expect(identify.inputSchema.safeParse({ items: [{ name: "   " }] }).success).toBe(false);
    expect(identify.inputSchema.safeParse({ items: [] }).success).toBe(false);
  });

  it("flags a duplicate of a tool already in the catalogue", async () => {
    const result = await runIdentify([{ name: "Form 4" }]);

    expect(result.items[0].duplicateOf).toMatchObject({ kind: "tool", name: "Form 4" });
  });
});

describe("identify_tools — no empty items (amendment \"No empty items\")", () => {
  async function pendingNamed(name: string) {
    const db = await getDb();
    return db.select().from(pendingTools).where(eq(pendingTools.name, name));
  }

  it("refuses the placeholder the assistant once wrote, saves nothing and tells the model to ask", async () => {
    const context = ctx();
    const result = await runIdentify([{ name: "Equipment not specified", confidence: "unsure", seenIn: "listed" }], context);

    expect(result.card_rendered).toBe(false);
    expect(result.error).toContain('"Equipment not specified" does not name a piece of equipment');
    expect(result.error).toContain("Nothing was saved");
    expect(result.error).toContain("its name (make and model), a photo of it or its label, or a list or spreadsheet");
    expect(result.error).toContain("call identify_tools again");
    expect(result.batchId).toBeUndefined();
    expect((context.writer as ReturnType<typeof fakeWriter>).write).not.toHaveBeenCalled();
    expect(await pendingNamed("Equipment not specified")).toEqual([]);
  });

  it("saves none of a turn's items when one of them is a placeholder", async () => {
    const result = await runIdentify([
      { name: "Zorbex Placeholder-Guard Laminator ZL-7" },
      { name: "Unknown" },
      { name: "  new item  " },
    ]);

    expect(result.card_rendered).toBe(false);
    expect(result.error).toContain('"Unknown" and "new item" do not name a piece of equipment');
    expect(await pendingNamed("Zorbex Placeholder-Guard Laminator ZL-7")).toEqual([]);
  });

  it("accepts a plain descriptive name for an item it can see but not name", async () => {
    const result = await runIdentify([{ name: "Cordless drill, brand not visible", confidence: "unsure" }]);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("Cordless drill, brand not visible");
  });
});

describe("identify_tools — a photo for a name (amendment \"A photo for a name\")", () => {
  it("looks up one photo for each item named without one, charged a quarter item each, and shows it searching", async () => {
    const db = await getDb();
    const before = await db.select({ id: researchRequests.id }).from(researchRequests);
    const context = ctx();
    const result = await runIdentify(
      [
        { name: "Zorbex Photo-Lookup Laminator ZL-9", brand: "Zorbex" },
        { name: "Quillon Photo-Lookup Grinder QG-2" },
        { name: "Cordless drill, brand not visible", confidence: "unsure" },
      ],
      context
    );

    // Two named items, one `unsure` left without a lookup.
    expect(result.photoSearch).toEqual({ searching: 2 });
    expect(wf.start).toHaveBeenCalledTimes(1);
    const [, [requestId, ids]] = wf.start.mock.calls[0] as [unknown, [string, string[]]];
    expect(ids).toEqual(result.items.slice(0, 2).map((item) => item.id));

    const payload = writtenPayload(context);
    expect(payload.items.map((item) => item.foundPhoto?.status ?? null)).toEqual(["searching", "searching", null]);
    for (const id of ids) {
      const [row] = await db.select({ foundPhoto: pendingTools.foundPhoto }).from(pendingTools).where(eq(pendingTools.id, id));
      expect(row.foundPhoto).toMatchObject({ requestId, status: "searching" });
    }
    // Two lookups, a quarter item each: one ledger row, under the request's id.
    const after = await db.select({ requestId: researchRequests.requestId }).from(researchRequests);
    expect(after.length - before.length).toBe(1);
    expect(after.filter((row) => row.requestId === requestId)).toHaveLength(1);
  });

  it("looks nothing up for an item that came with a photo", async () => {
    const mine = await upload();
    const result = await runIdentify([{ name: "Zorbex Photo-Given Extruder 7", attachmentIds: [mine] }], ctx({ attachments: [photo(mine)] }));
    expect(result.photoSearch).toBeUndefined();
    expect(wf.start).not.toHaveBeenCalled();
  });

  it("marks the lookups failed when the workflow will not start, and still saves the items", async () => {
    wf.start.mockRejectedValue(new Error("no world"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const context = ctx();
    const result = await runIdentify([{ name: "Zorbex Photo-Start Laminator ZL-11" }], context);
    expect(result.items).toHaveLength(1);
    expect(result.photoSearch).toEqual({ searching: 0, startFailed: true });
    expect(writtenPayload(context).items[0].foundPhoto?.status).toBe("failed");
  });
});

describe("identify_tools — the card and the model's answer", () => {
  it("emits exactly one data-intake-table part with the payload shape", async () => {
    const context = ctx();
    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000", brand: "Zorbex" }, { name: "Form 4" }],
      context
    );

    const payload = writtenPayload(context);
    expect(payload.kind).toBe("intake-table");
    expect(payload.batchId).toBe(result.batchId);
    expect(payload.warnings).toEqual([]);
    expect(payload.items.map((item) => item.name)).toEqual([
      "Zorbex Filament Extruder 9000",
      "Form 4",
    ]);
    const [extruder, form4] = payload.items;
    expect(extruder).toMatchObject({
      id: result.items[0].id,
      batchId: result.batchId,
      status: "identified",
      brand: "Zorbex",
      duplicateOf: null,
      duplicateResolution: null,
      confidenceLevel: null,
      photos: [],
    });
    expect(typeof extruder.createdAt).toBe("string");
    expect(form4.duplicateOf).toMatchObject({ kind: "tool", name: "Form 4" });
  });

  it("hands the model a compact result with no research and no confidence", async () => {
    const result = await runIdentify([{ name: "Zorbex Filament Extruder 9000" }]);

    // `photoSearch` too when the item gets a photo looked up (amendment "A photo for a name").
    const { photoSearch, ...rest } = result;
    expect(Object.keys(rest).sort()).toEqual(["batchId", "card_rendered", "items", "warnings"]);
    if (photoSearch) expect(Object.keys(photoSearch)).toEqual(["searching"]);
    expect(result.card_rendered).toBe(true);
    expect(Object.keys(result.items[0]).sort()).toEqual(["certainty", "duplicateOf", "id", "name", "quantity"]);
    const text = JSON.stringify(result);
    expect(text).not.toMatch(/research|confidence|evidence/i);
  });

  it("refuses without a signed-in person, and saves nothing", async () => {
    const context = ctx({ identity: undefined });
    const result = await runIdentify([{ name: "Zorbex Filament Extruder 9000" }], context);

    expect(result.card_rendered).toBe(false);
    expect(result.error).toMatch(/sign in/i);
    expect((context.writer as ReturnType<typeof fakeWriter>).write).not.toHaveBeenCalled();
    const db = await getDb();
    const rows = await db
      .select()
      .from(pendingTools)
      .where(eq(pendingTools.name, "Zorbex Filament Extruder 9000"));
    expect(rows).toHaveLength(0);
  });

  it("refuses an anonymous identity the same way", async () => {
    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000" }],
      ctx({ identity: { ...admin(), role: "anonymous", userId: null } })
    );
    expect(result.error).toMatch(/sign in/i);
  });

  it("turns an unreachable database into one sentence for the model", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    pendingHook.failWith = new DbUnavailableError(new Error("ECONNREFUSED"));
    const context = ctx();

    const result = await runIdentify([{ name: "Zorbex Filament Extruder 9000" }], context);

    expect(result.card_rendered).toBe(false);
    expect(result.error).toMatch(/unreachable.*nothing was saved/i);
    expect((context.writer as ReturnType<typeof fakeWriter>).write).not.toHaveBeenCalled();
  });
});

describe("identify_tools — photos", () => {
  it("promotes the claimed photos, and the card shows them", async () => {
    const front = await upload();
    const context = ctx({ attachments: [photo(front)] });

    await runIdentify([{ name: "Zorbex Filament Extruder 9000" }], context);

    expect(promote.fn).toHaveBeenCalledExactlyOnceWith([front]);
    const payload = writtenPayload(context);
    expect(payload.warnings).toEqual([]);
    expect(payload.items[0].photos).toEqual([
      expect.objectContaining({
        attachmentId: front,
        url: `https://store.public.blob.vercel-storage.com/${front}.jpg`,
      }),
    ]);
  });

  it("says the photos are not public when promotion fails", async () => {
    const front = await upload();
    promote.fn.mockResolvedValue({ promoted: 0, failed: 1, skipped: 0 });
    const context = ctx({ attachments: [photo(front)] });

    const result = await runIdentify([{ name: "Zorbex Filament Extruder 9000" }], context);

    expect(result.warnings).toEqual(["photos_not_public"]);
    const payload = writtenPayload(context);
    expect(payload.warnings).toEqual(["photos_not_public"]);
    expect(payload.items[0].photos[0].url).toBeNull();
  });

  it("says the photos are not public when promotion throws, and still renders the card", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const front = await upload();
    promote.fn.mockRejectedValue(new Error("blob down"));
    const context = ctx({ attachments: [photo(front)] });

    const result = await runIdentify([{ name: "Zorbex Filament Extruder 9000" }], context);

    expect(result.card_rendered).toBe(true);
    expect(result.warnings).toEqual(["photos_not_public"]);
  });

  it("never promotes a photo it did not claim", async () => {
    // Already somebody else's — say, the photo on a maintenance ticket.
    const taken = await upload();
    const db = await getDb();
    await db
      .update(attachments)
      .set({ ownerType: "maintenance_log", ownerId: crypto.randomUUID() })
      .where(eq(attachments.id, taken));

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000", attachmentIds: [taken] }],
      ctx({ attachments: [photo(taken)] })
    );

    expect(promote.fn).not.toHaveBeenCalled();
    expect(result.warnings).toEqual(["photos_not_attached"]);
    expect((await attachmentRow(taken)).access).toBe("private");
  });
});

describe("identify_tools — many items at once (amendment \"Many items at once\")", () => {
  it("turns one message with two photos into one pending item per distinct object", async () => {
    const [bench, shelf] = [await upload(), await upload()];
    const context = ctx({ attachments: [photo(bench, "bench.jpg"), photo(shelf, "shelf.jpg")] });

    // What a vision model hands over for a bench (drill press, Cricut) and a
    // shelf (the same Cricut again, two batteries, something it cannot name).
    const result = await runIdentify(
      [
        { name: "Zorbex Drill Press DP-10", brand: "Zorbex", attachmentIds: [bench], confidence: "sure", seenIn: "photo 1, left" },
        { name: "Quillon Cutter Q3", brand: "Quillon", attachmentIds: [bench], confidence: "likely", seenIn: "photo 1, right" },
        { name: "Cutter Q3", brand: "Quillon", attachmentIds: [shelf], confidence: "sure", seenIn: "photo 2, top shelf" },
        { name: "two Zorbex 18V batteries", attachmentIds: [shelf], seenIn: "photo 2" },
        { name: "Cordless tool, brand not visible", attachmentIds: [shelf], confidence: "unsure", seenIn: "photo 2, bottom" },
      ],
      context
    );

    // Five entries, four objects: the cutter seen twice is one item.
    expect(result.items.map((item) => [item.name, item.quantity, item.certainty])).toEqual([
      ["Zorbex Drill Press DP-10", 1, "sure"],
      ["Quillon Cutter Q3", 1, "sure"],
      ["Zorbex 18V batteries", 2, null],
      ["Cordless tool, brand not visible", 1, "unsure"],
    ]);
    expect(result).toMatchObject({ mergedEntries: 1, warnings: [] });

    const db = await getDb();
    const rows = await db.select().from(pendingTools).where(eq(pendingTools.batchId, result.batchId));
    expect(rows).toHaveLength(4);
    const byName = new Map(rows.map((row) => [row.name, row]));
    expect(byName.get("Zorbex 18V batteries")?.quantity).toBe(2);
    expect(byName.get("Quillon Cutter Q3")).toMatchObject({ identifyConfidence: "sure", seenIn: "photo 1, right; photo 2, top shelf" });

    // Each photo is claimed once, by the first item that shows it; every other
    // item that shows it has its own public copy — each a "Your photo" choice.
    expect((await attachmentRow(bench)).ownerId).toBe(result.items[0].id);
    expect((await attachmentRow(shelf)).ownerId).toBe(result.items[1].id);
    expect(share.fn).toHaveBeenCalledTimes(1);
    const [requests] = share.fn.mock.calls[0];
    expect(requests).toEqual([
      { attachmentId: bench, ownerId: result.items[1].id, position: 1 },
      { attachmentId: shelf, ownerId: result.items[2].id, position: 0 },
      { attachmentId: shelf, ownerId: result.items[3].id, position: 0 },
    ]);

    const payload = writtenPayload(context);
    expect(payload.items.map((item) => item.photos.length)).toEqual([1, 2, 1, 1]);
    expect(payload.items.every((item) => item.photos.every((p) => p.url !== null))).toBe(true);
    expect(payload.items[3]).toMatchObject({ identifyConfidence: "unsure", seenIn: "photo 2, bottom", quantity: 1 });
    expect(typeof payload.researchLeft).toBe("number");
  });

  it("still flags an item that is already in the inventory", async () => {
    const result = await runIdentify([
      { name: "Form 4", attachmentIds: [] },
      { name: "Zorbex Filament Extruder 9000" },
    ]);
    expect(result.items[0].duplicateOf).toMatchObject({ kind: "tool", name: "Form 4" });
    expect(result.items[1].duplicateOf).toBeNull();
  });

  it("records a typed list's counts as quantities", async () => {
    const result = await runIdentify([
      { name: "Zorbex Drill Press DP-10", seenIn: "listed" },
      { name: "Zorbex 18V battery", quantity: 2, seenIn: "listed" },
      { name: "3x Quillon Clamp QC-4", seenIn: "listed" },
    ]);
    expect(result.items.map((item) => [item.name, item.quantity])).toEqual([
      ["Zorbex Drill Press DP-10", 1],
      ["Zorbex 18V battery", 2],
      ["Quillon Clamp QC-4", 3],
    ]);
  });

  it("says so when a photo could not be copied to every item that shows it", async () => {
    const bench = await upload();
    share.fn.mockResolvedValue({ shared: 0, failed: 1 });
    const result = await runIdentify(
      [
        { name: "Zorbex Drill Press DP-10", attachmentIds: [bench] },
        { name: "Quillon Cutter Q3", attachmentIds: [bench] },
      ],
      ctx({ attachments: [photo(bench)] })
    );
    expect(result.warnings).toEqual(["photos_not_shared"]);
    expect((await attachmentRow(bench)).ownerId).toBe(result.items[0].id);
  });

  it("takes the new fields from the model and refuses a bad one", () => {
    const parsed = identify.inputSchema.safeParse({
      items: [{ name: "Drill", quantity: 2, confidence: "unsure", seenIn: "photo 1" }],
    });
    expect(parsed.success).toBe(true);
    expect(identify.inputSchema.safeParse({ items: [{ name: "Drill", confidence: "maybe" }] }).success).toBe(false);
    expect(identify.inputSchema.safeParse({ items: [{ name: "Drill", quantity: 0 }] }).success).toBe(false);
    expect(identify.inputSchema.safeParse({ items: [{ name: "Drill", quantity: 51 }] }).success).toBe(false);
  });
});

// ── create_tool (MCP only) ─────────────────────────────────────────

/** A candidate that matches nothing in the demo catalogue. */
function candidate(over: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    // Letters only: a hex suffix with digits reads as a part number to the display rules.
    name: `Zorbex Laminator ${crypto.randomUUID().slice(0, 8).replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)])}`,
    description: "A desktop laminator.",
    materials: ["Paper"],
    ppe_required: [],
    tags: ["laminating"],
    units: [],
    resources: [],
    image_upload_ids: [],
    source_urls: [],
    ...over,
  };
}

interface CreateResult {
  success: boolean;
  tool_id: string | null;
  unit_ids: string[];
  slug: string | null;
  draft_url: string | null;
  created: {
    tool: boolean;
    category: { id: string; isNew: boolean } | null;
    categoryProposal?: { id: string; name: string } | null;
    location: { id: string; isNew: boolean } | null;
    units: number;
    resources: number;
  };
  warnings: string[];
}

async function runCreate(c: ToolCandidate): Promise<CreateResult> {
  return (await createTool.run(createTool.inputSchema.parse({ candidate: c }), {})) as CreateResult;
}

describe("splitCandidateNames — create_tool's two names (tool display names spec §5.6)", () => {
  it("keeps a display name that follows the rules, with the official name given", () => {
    expect(splitCandidateNames("Makita Plunge Base", "Makita 196094-2 Compact Router Plunge Base")).toEqual({
      name: "Makita Plunge Base",
      officialName: "Makita 196094-2 Compact Router Plunge Base",
      shortened: false,
    });
    expect(splitCandidateNames("Formlabs Form 4", null)).toEqual({ name: "Formlabs Form 4", officialName: null, shortened: false });
  });

  it("moves a listing-style name to the official name and shortens the display name", () => {
    expect(splitCandidateNames("Festool 575267 Dust Extractor CT Midi Hepa", null)).toEqual({
      name: "Festool Dust Extractor CT Midi Hepa",
      officialName: "Festool 575267 Dust Extractor CT Midi Hepa",
      shortened: true,
    });
  });

  it("never replaces an official name the caller gave", () => {
    expect(splitCandidateNames("Festool 575267 Dust Extractor", "Festool CT MIDI I HEPA 575267")).toMatchObject({
      name: "Festool Dust Extractor",
      officialName: "Festool CT MIDI I HEPA 575267",
    });
  });
});

describe("create_tool — a name that says nothing (amendment \"No empty items\")", () => {
  it("refuses a placeholder name and writes nothing", async () => {
    const db = await getDb();
    const before = await db.select({ id: tools.id }).from(tools);
    const result = await runCreate(candidate({ name: "Equipment not specified" }));

    expect(result.success).toBe(false);
    expect(result.tool_id).toBeNull();
    expect(result.warnings.at(-1)).toContain('"Equipment not specified" does not name a piece of equipment, so nothing was saved');
    expect(await db.select({ id: tools.id }).from(tools)).toHaveLength(before.length);
  });
});

describe("create_tool — an MCP draft on Postgres", () => {
  beforeEach(() => {
    server.use(
      http.get("https://manuals.example.test/laminator.pdf", () => new HttpResponse(null, { status: 200 })),
      http.get("https://manuals.example.test/missing.pdf", () => new HttpResponse(null, { status: 404 }))
    );
  });

  it("stores a listing-style name as the official name, a short display name, and says so", async () => {
    const suffix = crypto.randomUUID().slice(0, 6).replace(/[0-9]/g, (d) => "ghijklmnop"[Number(d)]);
    const result = await runCreate(candidate({ name: `Zorbex ${suffix} 575267 Thermal Laminator 12-Inch` }));
    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining("shortened")]);
    const [tool] = await (await getDb()).select().from(tools).where(eq(tools.id, result.tool_id!));
    expect(tool.name).toBe(`Zorbex ${suffix} Thermal Laminator`);
    expect(tool.officialName).toBe(`Zorbex ${suffix} 575267 Thermal Laminator 12-Inch`);
  });

  it("writes an unpublished tool with its units, taxonomy and verified resources", async () => {
    const c = candidate({
      // An existing category by its slug (the demo seed's v2 tree): matched, never created.
      category: { name: "Office", group: "Shop Infrastructure & Supplies", isNew: false, slug: "office" },
      location: { room: "Studio B", zone: "Bench 3", isNew: true },
      units: [
        { label: "Laminator #1", serial: "LAM-001", status: "Available", condition: "New" },
        { label: "Laminator #2" },
      ],
      resources: [
        { title: "Laminator manual", url: "https://manuals.example.test/laminator.pdf", type: "Manual" },
      ],
    });

    const result = await runCreate(c);

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(result.draft_url).toBe(`/tools/${result.slug}`);
    const db = await getDb();
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.tool_id!));
    expect(tool.name).toBe(c.name);
    expect(tool.published).toBe(false);
    expect(tool.materials).toEqual(["Paper"]);

    const [category] = await db.select().from(categories).where(eq(categories.id, tool.categoryId!));
    expect(category.slug).toBe("office");
    const [location] = await db.select().from(locations).where(eq(locations.id, tool.locationId!));
    expect(location.room).toBe("Studio B");
    expect(result.created.category).toEqual({ id: category.id, isNew: false });

    const toolUnits = await db.select().from(units).where(eq(units.toolId, tool.id));
    expect(toolUnits.map((u) => u.unitLabel).sort()).toEqual(["Laminator #1", "Laminator #2"]);
    const first = toolUnits.find((u) => u.unitLabel === "Laminator #1");
    expect(first?.serialNumber).toBe("LAM-001");
    expect(first?.status).toBe("available");
    expect(first?.condition).toBe("new");
    expect(result.unit_ids).toHaveLength(2);

    const toolResources = await db.select().from(resources).where(eq(resources.toolId, tool.id));
    expect(toolResources.map((r) => r.url)).toEqual(["https://manuals.example.test/laminator.pdf"]);
  });

  it("never creates a category: an unknown one is proposed for review, and the draft has none (taxonomy v2)", async () => {
    const db = await getDb();
    const before = (await db.select().from(categories)).length;
    const result = await runCreate(candidate({ category: { name: "Laminating", group: "Shop Infrastructure & Supplies", isNew: true } }));

    expect(result.success).toBe(true);
    expect((await db.select().from(categories)).length).toBe(before);
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.tool_id!));
    expect(tool.categoryId).toBeNull();
    const [shop] = await db.select().from(categories).where(eq(categories.slug, "shop-infrastructure-supplies"));
    const [proposal] = await db.select().from(categoryProposals).where(eq(categoryProposals.subjectId, tool.id));
    expect(proposal).toMatchObject({ name: "Laminating", parentId: shop.id, source: "mcp", subjectType: "tool", status: "pending" });
    expect(result.created.categoryProposal).toEqual({ id: proposal.id, name: "Laminating" });
    expect(result.warnings.join(" ")).toMatch(/proposed for review on \/admin\/taxonomy/);
  });

  it("matches an existing category by its exact name when no slug is given", async () => {
    const result = await runCreate(candidate({ category: { name: "hand saws", group: "", isNew: false } }));
    const db = await getDb();
    const [tool] = await db.select().from(tools).where(eq(tools.id, result.tool_id!));
    const [saws] = await db.select().from(categories).where(eq(categories.slug, "hand-saws"));
    expect(tool.categoryId).toBe(saws.id);
    expect(result.warnings).toEqual([]);
  });

  it("invalidates the catalogue once the draft has landed", async () => {
    vi.mocked(revalidateTag).mockClear();
    await runCreate(candidate());
    expect(vi.mocked(revalidateTag)).toHaveBeenCalledWith("catalog", { expire: 0 });
  });

  it("drops a link that does not verify, and says so", async () => {
    const result = await runCreate(
      candidate({
        resources: [
          { title: "Laminator manual", url: "https://manuals.example.test/laminator.pdf", type: "Manual" },
          { title: "Missing manual", url: "https://manuals.example.test/missing.pdf", type: "Manual" },
        ],
      })
    );

    expect(result.success).toBe(true);
    expect(result.created.resources).toBe(1);
    expect(result.warnings).toEqual([
      expect.stringMatching(/^Skipped unverifiable link — Manual "Missing manual".*HTTP 404/),
    ]);
    const db = await getDb();
    const rows = await db.select().from(resources).where(eq(resources.toolId, result.tool_id!));
    expect(rows.map((r) => r.title)).toEqual(["Laminator manual"]);
  });

  it("warns that photos cannot come over MCP, and never claims them", async () => {
    const orphan = await upload();

    const result = await runCreate(candidate({ image_upload_ids: [orphan] }));

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([expect.stringMatching(/photo was not attached.*MCP/i)]);
    expect((await attachmentRow(orphan)).ownerId).toBeNull();
  });

  it("keeps an unknown unit status to the default and reports it", async () => {
    const result = await runCreate(candidate({ units: [{ label: "L #1", status: "Sparkling" }] }));

    expect(result.success).toBe(true);
    expect(result.warnings).toEqual([expect.stringContaining('status "Sparkling"')]);
    const db = await getDb();
    const [unit] = await db.select().from(units).where(eq(units.id, result.unit_ids[0]));
    expect(unit.status).toBe("available");
  });

  it("reports that nothing landed when the write fails, taxonomy included", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const categoryName = `Rollback Category ${crypto.randomUUID().slice(0, 8)}`;

    // A blank name is refused inside the transaction, after the category.
    const result = await runCreate(
      candidate({ name: "   ", category: { name: categoryName, group: "Test", isNew: true } })
    );

    expect(result.success).toBe(false);
    expect(result.tool_id).toBeNull();
    expect(result.created).toEqual({ tool: false, category: null, location: null, units: 0, resources: 0 });
    expect(result.warnings.at(-1)).toMatch(/nothing was saved/);
    const db = await getDb();
    const leftovers = await db.select().from(categories).where(eq(categories.name, categoryName));
    expect(leftovers).toHaveLength(0);
  });
});

// ── start_import (bulk intake spec §3.5) ────────────────────────────

describe("start_import", () => {
  const startImportTool = toolByName("start_import");

  it("makes an import from a pasted list and shows the card — no identify_tools, no rows in the chat", async () => {
    const writer = fakeWriter();
    const tag = crypto.randomUUID().slice(0, 6);
    const list = Array.from({ length: 18 }, (_, i) => `- Chat import item ${tag} ${i}`).join("\n");
    const result = (await startImportTool.run({ text: list }, ctx({ writer }))) as {
      card_rendered: boolean;
      importId: string;
      itemCount: number;
      needsColumns: boolean;
    };
    expect(result).toMatchObject({ card_rendered: true, itemCount: 18, needsColumns: false });

    const parts = writer.write.mock.calls.map(([part]) => part);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: "data-import-card",
      data: { kind: "import-card", href: `/admin/intake/imports/${result.importId}`, import: { itemCount: 18, sourceKind: "chat" } },
    });
    // Rows exist for review; none became a chat intake table.
    expect(parts.some((part: { type: string }) => part.type === "data-intake-table")).toBe(false);
    const db = await getDb();
    const rows = await db.select().from(pendingTools).where(eq(pendingTools.importId, result.importId));
    expect(rows).toHaveLength(18);
    expect(rows.every((row) => row.status === "identified")).toBe(true);
  });

  it("refuses without a signed-in account, and says why a file was refused", async () => {
    expect(await startImportTool.run({ text: "a\nb" }, ctx({ identity: undefined }))).toMatchObject({ card_rendered: false });
    const missing = (await startImportTool.run({ attachmentId: crypto.randomUUID() }, ctx())) as { error: string };
    expect(missing.error).toMatch(/could not be found/);
  });

  it("says how long a refused document is in pages, and how many items a refused list has (amendment 2026-09-24)", async () => {
    const sentence = "The lab keeps a laser cutter in the back room and services it every spring for the students. ";
    const prose = sentence.repeat(Math.ceil(280_000 / sentence.length)).slice(0, 280_000);
    const long = (await startImportTool.run({ text: prose }, ctx())) as { card_rendered: boolean; error: string };
    expect(long.card_rendered).toBe(false);
    expect(long.error).toContain("about 85 pages of text; the limit is about 60 pages (200,000 characters)");
    expect(long.error).toMatch(/split it into parts/);

    const lines = Array.from({ length: 1001 }, (_, i) => `- Clamp ${i}`).join("\n");
    const many = (await startImportTool.run({ text: lines }, ctx())) as { error: string };
    expect(many.error).toContain("That list has 1,001 items; one import takes at most 1,000.");
  });

  it("accepts either a file or text, not both", () => {
    expect(startImportTool.inputSchema.safeParse({ text: "x", attachmentId: "y" }).success).toBe(false);
    expect(startImportTool.inputSchema.safeParse({}).success).toBe(false);
  });

  it("is in the prompt: long lists and attached documents go to start_import", () => {
    const prompt = intake.promptFragment({ tools: [] });
    expect(prompt).toContain("start_import");
    expect(prompt).toContain("[Attached documents: attachment_id=");
    expect(prompt).toMatch(/do not\*\* call `identify_tools` for that list/);
  });
});

// ── Surfaces ───────────────────────────────────────────────────────

describe("which surface sees which intake tool", () => {
  it("gives the chat identify_tools and start_import, and never create_tool", () => {
    const names = Object.keys(toAiTools([intake], ctx()));
    expect(names).toEqual(["identify_tools", "start_import"]);
  });

  it("registers create_tool over MCP for an admin, and never identify_tools", () => {
    const registered: string[] = [];
    const fake = { registerTool: (name: string) => registered.push(name) };
    registerAll(fake as unknown as McpServer, [intake], { access: mcpAccessFor("admin") });
    expect(registered).toEqual(["create_tool"]);
  });

  it("registers nothing from intake for a read-only token, a student or an anonymous caller", () => {
    for (const access of [mcpAccessFor("admin", true), mcpAccessFor("user"), mcpAccessFor("anonymous")]) {
      const registered: string[] = [];
      const fake = { registerTool: (name: string) => registered.push(name) };
      registerAll(fake as unknown as McpServer, [intake], { access });
      expect(registered).toEqual([]);
    }
  });
});

// ── Prompt and access ──────────────────────────────────────────────

describe("the intake prompt", () => {
  const env = { tools: [] };
  const prompt = intake.promptFragment(env);

  it("identifies only, with the two-search rule", () => {
    expect(IDENTIFY_MAX_MODEL_NAME_SEARCHES).toBe(2);
    expect(prompt).toContain("act as an intake agent");
    expect(prompt).toContain("You may use `exa_search` at most 2 times");
    expect(prompt).toMatch(/only when a model name is genuinely unclear/);
    expect(prompt).toContain("never `read_page` a manual");
    expect(prompt).toContain("identify_tools");
    expect(prompt).toContain("[Attached photos: attachment_id=");
  });

  it("carries none of the old research instructions", () => {
    for (const gone of [
      "research_tool",
      "propose_listing",
      "create_tool",
      "source_urls",
      "evidence",
      "manual PDF URL",
      "confirm add:",
      // Anthropic's server tools, retired with the Gateway (gateway spec §3.2–3.3).
      "web_search",
      "web_fetch",
    ]) {
      expect(prompt).not.toContain(gone);
    }
  });

  it("settles the official name for an item named without a photo, and leaves the photo to the table", () => {
    expect(prompt).toContain("**Named without a photo?**");
    expect(prompt).toContain('"Apple iPad (6th generation)" for "an iPad 6"');
    expect(prompt).toContain('marked "Found online" until someone approves the item');
    expect(prompt).toContain("Never look for photos yourself");
  });

  it("asks what the item is when nothing was named, and never records a placeholder", () => {
    expect(prompt).toContain("**Nothing named, nothing created.**");
    expect(prompt).toContain("I'd like to add new equipment to the inventory.");
    expect(prompt).toContain("do not call " + "`identify_tools`" + " — ask what it is");
    expect(prompt).toContain("its name (make and model), a photo of it or its label, or a list or spreadsheet");
    expect(prompt).toContain("Create nothing until you have one.");
    expect(prompt).toContain('Never record a placeholder such as "Equipment not specified"');
  });

  it("resolves duplicates on the table, not in chat", () => {
    expect(prompt).toMatch(/Duplicates are resolved on the table, not in chat/);
  });

  it("asks for every item, one per object, with counts and certainty", () => {
    expect(prompt).toContain("Look for every distinct piece of equipment");
    expect(prompt).toContain("the same object in two photos is ONE item");
    expect(prompt).toContain("quantity 2");
    expect(prompt).toContain("`unsure`");
    expect(prompt).toContain("Add to research");
  });
});

describe("intake access", () => {
  it("requires the tools.add permission", () => {
    expect(intake.requiredPermission).toBe("tools.add");
  });

  it("explains the limit instead of the flow when locked", () => {
    const locked = intake.lockedPromptFragment?.({ tools: [] }) ?? "";
    expect(locked).toContain("limited to lab staff");
    expect(locked).not.toContain("identify_tools");
  });
});
