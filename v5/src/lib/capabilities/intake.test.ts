// @vitest-environment node
import { eq, inArray, notInArray } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import type { UIMessageStreamWriter } from "ai";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { nextCacheMock } from "../../../test/mocks/next-cache";
import { server } from "../../../test/msw/server";

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
  locations,
  pendingTools,
  resources,
  tools,
  units,
} from "../db/schema/index";
import { IDENTIFY_MAX_ITEMS, IDENTIFY_MAX_MODEL_NAME_SEARCHES } from "../intake/limits";
import type { IntakeTablePayload } from "../intake/types";
import { toAiTools } from "./chat-adapter";
import { intake } from "./intake";
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
  items: { id: string; name: string; duplicateOf: { kind: string; name: string } | null }[];
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

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  pendingHook.failWith = null;
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

  it("does not spread the turn's photos across a batch, and says one went unused", async () => {
    const front = await upload();

    const result = await runIdentify(
      [{ name: "Zorbex Filament Extruder 9000" }, { name: "Quillon Bench Grinder QB-6" }],
      ctx({ attachments: [photo(front)] })
    );

    expect((await attachmentRow(front)).ownerId).toBeNull();
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

    expect(Object.keys(result).sort()).toEqual(["batchId", "card_rendered", "items", "warnings"]);
    expect(result.card_rendered).toBe(true);
    expect(Object.keys(result.items[0]).sort()).toEqual(["duplicateOf", "id", "name"]);
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

// ── create_tool (MCP only) ─────────────────────────────────────────

/** A candidate that matches nothing in the demo catalogue. */
function candidate(over: Partial<ToolCandidate> = {}): ToolCandidate {
  return {
    name: `Zorbex Laminator ${crypto.randomUUID().slice(0, 8)}`,
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
    location: { id: string; isNew: boolean } | null;
    units: number;
    resources: number;
  };
  warnings: string[];
}

async function runCreate(c: ToolCandidate): Promise<CreateResult> {
  return (await createTool.run(createTool.inputSchema.parse({ candidate: c }), {})) as CreateResult;
}

describe("create_tool — an MCP draft on Postgres", () => {
  beforeEach(() => {
    server.use(
      http.get("https://manuals.example.test/laminator.pdf", () => new HttpResponse(null, { status: 200 })),
      http.get("https://manuals.example.test/missing.pdf", () => new HttpResponse(null, { status: 404 }))
    );
  });

  it("writes an unpublished tool with its units, taxonomy and verified resources", async () => {
    const c = candidate({
      category: { name: "Laminating", group: "Paper Craft", isNew: true },
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
    expect(category.name).toBe("Laminating");
    const [location] = await db.select().from(locations).where(eq(locations.id, tool.locationId!));
    expect(location.room).toBe("Studio B");
    expect(result.created.category?.isNew).toBe(true);

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

  it("registers create_tool over MCP with writes allowed, and never identify_tools", () => {
    const registered: string[] = [];
    const fake = { registerTool: (name: string) => registered.push(name) };
    registerAll(fake as unknown as McpServer, [intake], { allowWrites: true });
    expect(registered).toEqual(["create_tool"]);
  });

  it("registers nothing from intake over a read-only MCP", () => {
    const registered: string[] = [];
    const fake = { registerTool: (name: string) => registered.push(name) };
    registerAll(fake as unknown as McpServer, [intake], { allowWrites: false });
    expect(registered).toEqual([]);
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

  it("resolves duplicates on the table, not in chat", () => {
    expect(prompt).toMatch(/Duplicates are resolved on the table, not in chat/);
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
