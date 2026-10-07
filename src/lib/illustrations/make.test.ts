// @vitest-environment node
import { eq } from "drizzle-orm";

vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { imageModel, resetModelStubs, setImageModel } from "../../../test/ai/models-stub";
import { makePng } from "../../../test/gateway/png";
import { insertUserRow } from "../../../test/utils/session";
import type { BlobStore } from "../blob";
import { createPgliteDb } from "../db/pglite";
import { chatIllustrations } from "../db/schema/index";
import type { Db } from "../db/types";
import { ILLUSTRATION_DAILY_PER_PERSON } from "./limits";
import { estimatedCostFor, makeIllustration } from "./make";
import type { PromptCatalogEntry } from "./prompt";

/**
 * One chat illustration end to end (gateway spec amendment 2026-10-07), with
 * the image model stubbed at the AI SDK boundary and the Blob store a fake:
 * nothing paid for before every free check, the prompt the server's, the
 * picture checked and stored private, the cost logged and recorded, and every
 * failure leaving a `failed` row that costs nobody a place.
 */

let db: Db;
let userId: string;
const PNG = makePng({ width: 64, height: 64, alpha: false });
const CATALOG: PromptCatalogEntry[] = [{ name: "Trotec Speedy 400", category: "Laser & CNC", categorySub: "Laser Cutter" }];

function fakeStore() {
  const putUpload = vi.fn(async (prefix: string, file: File) => ({ pathname: `${prefix}${file.name}-abc`, url: "https://blob.example/x" }));
  return { store: { putUpload } as unknown as BlobStore, putUpload };
}

beforeAll(async () => {
  db = await createPgliteDb();
});

beforeEach(async () => {
  await db.delete(chatIllustrations);
  userId = (await insertUserRow(db)).id;
  vi.stubEnv("MODEL_ILLUSTRATION", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  resetModelStubs();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function rows() {
  return db.select().from(chatIllustrations);
}

describe("makeIllustration", () => {
  it("draws, checks and stores the picture privately, and records what the Gateway said it cost", async () => {
    const model = imageModel([PNG], { cost: "0.007" });
    setImageModel(model);
    const { store, putUpload } = fakeStore();

    const result = await makeIllustration(
      { userId, kind: "plan", description: "1. Cut the panels on the Trotec Speedy 400\n2. Press the start button\n3. Glue the box", catalog: CATALOG },
      { db, store }
    );

    expect(result).toMatchObject({ ok: true, width: 64, height: 64, kind: "plan", costUsd: 0.007 });
    const id = (result as { id: string }).id;
    expect((result as { url: string }).url).toBe(`/api/chat/illustrations/${id}`);

    // The prompt is the server's: the lab's machine generic, the control sentence gone, square, one image.
    expect(model.doGenerateCalls).toHaveLength(1);
    const call = model.doGenerateCalls[0];
    expect(call).toMatchObject({ size: "1024x1024", n: 1 });
    expect(call.prompt).toContain("1. Cut the panels on the laser cutter\n3. Glue the box");
    expect(call.prompt).not.toMatch(/Trotec|start button/);

    // Private, under its own prefix — never an attachment.
    expect(putUpload).toHaveBeenCalledOnce();
    const [prefix, file, access] = putUpload.mock.calls[0] as unknown as [string, File, string];
    expect(prefix).toBe("chat/illustrations/");
    expect(access).toBe("private");
    expect(file.type).toBe("image/png");

    const [row] = await rows();
    expect(row).toMatchObject({ id, userId, kind: "plan", status: "ready", costUsd: 0.007, contentType: "image/png", width: 64, height: 64 });
    expect(row.blobPathname).toBe("chat/illustrations/illustration.png-abc");
    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/\[illustration\] plan answered: cost \$0\.0070/));
  });

  it("keeps the estimate as the cost when the Gateway reports none", async () => {
    setImageModel(imageModel([PNG]));
    const result = await makeIllustration({ userId, kind: "concept", description: "A birch-ring lamp", catalog: [] }, { db, store: fakeStore().store });
    expect(result).toMatchObject({ ok: true, costUsd: 0.007 });
    expect(estimatedCostFor("recraft/recraft-v4.1-flash")).toBe(0.007);
    expect(estimatedCostFor("meta/muse-image-1.0")).toBe(0.05);
  });

  it("calls nothing when switched off, without storage, without a person or with nothing to draw", async () => {
    const model = imageModel([PNG]);
    setImageModel(model);
    const input = { userId, kind: "plan" as const, description: "1. Sand the panels", catalog: [] };

    vi.stubEnv("MODEL_ILLUSTRATION", "off");
    expect(await makeIllustration(input, { db, store: fakeStore().store })).toEqual({ ok: false, reason: "off" });
    vi.stubEnv("MODEL_ILLUSTRATION", "");
    // The suite has no Blob store (BLOB_LOCAL_DISABLE=1), and none is passed.
    expect(await makeIllustration(input, { db })).toEqual({ ok: false, reason: "unavailable" });
    expect(await makeIllustration({ ...input, userId: null }, { db, store: fakeStore().store })).toEqual({ ok: false, reason: "sign_in" });
    expect(
      await makeIllustration({ ...input, description: "Press the start button on the control panel." }, { db, store: fakeStore().store })
    ).toEqual({ ok: false, reason: "nothing_to_draw" });

    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await rows()).toEqual([]);
  });

  it("refuses past the person's daily cap before calling the model", async () => {
    const model = imageModel([PNG], { cost: 0.007 });
    setImageModel(model);
    const input = { userId, kind: "concept" as const, description: "A desk organiser", catalog: [] };
    for (let i = 0; i < ILLUSTRATION_DAILY_PER_PERSON; i += 1) {
      expect((await makeIllustration(input, { db, store: fakeStore().store })).ok).toBe(true);
    }
    expect(await makeIllustration(input, { db, store: fakeStore().store })).toEqual({ ok: false, reason: "person_limit" });
    expect(model.doGenerateCalls).toHaveLength(ILLUSTRATION_DAILY_PER_PERSON);
  });

  it("refuses once the lab's daily budget is spent", async () => {
    setImageModel(imageModel([PNG]));
    const other = (await insertUserRow(db)).id;
    await db.insert(chatIllustrations).values({ userId: other, kind: "plan", model: "m/x", costUsd: 0.998, status: "ready" });
    expect(await makeIllustration({ userId, kind: "concept", description: "A desk organiser", catalog: [] }, { db, store: fakeStore().store })).toEqual({
      ok: false,
      reason: "lab_budget",
    });
  });

  it("marks a failed call failed at no cost, and logs its kind but never the prompt", async () => {
    setImageModel(imageModel([], { error: new Error("upstream said no: A desk organiser") }));
    const result = await makeIllustration({ userId, kind: "concept", description: "A desk organiser", catalog: [] }, { db, store: fakeStore().store });
    expect(result).toEqual({ ok: false, reason: "failed" });
    const [row] = await rows();
    expect(row).toMatchObject({ status: "failed", costUsd: 0 });
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).toMatch(/\[illustration\] .* failed/);
    expect(logged).not.toContain("desk organiser");
  });

  it("refuses an answer that is not an image, keeping the reported cost, and stores nothing", async () => {
    setImageModel(imageModel([new Uint8Array([1, 2, 3, 4])], { cost: "0.007" }));
    const { store, putUpload } = fakeStore();
    const result = await makeIllustration({ userId, kind: "concept", description: "A desk organiser", catalog: [] }, { db, store });
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(putUpload).not.toHaveBeenCalled();
    const [row] = await rows();
    expect(row).toMatchObject({ status: "failed", costUsd: 0.007 });
  });

  it("answers failed for a malformed MODEL_ILLUSTRATION, naming it, before reserving anything", async () => {
    vi.stubEnv("MODEL_ILLUSTRATION", "sk-live-abc123secret");
    const result = await makeIllustration({ userId, kind: "concept", description: "A desk organiser", catalog: [] }, { db, store: fakeStore().store });
    expect(result).toEqual({ ok: false, reason: "failed" });
    expect(await rows()).toEqual([]);
    const logged = vi.mocked(console.warn).mock.calls.flat().join(" ");
    expect(logged).toContain("MODEL_ILLUSTRATION");
    expect(logged).not.toContain("sk-live");
  });

  it("records the model that drew it", async () => {
    vi.stubEnv("MODEL_ILLUSTRATION", "meta/muse-image-1.0");
    setImageModel(imageModel([PNG]));
    const result = await makeIllustration({ userId, kind: "concept", description: "A desk organiser", catalog: [] }, { db, store: fakeStore().store });
    const [row] = await db.select().from(chatIllustrations).where(eq(chatIllustrations.id, (result as { id: string }).id));
    expect(row).toMatchObject({ model: "meta/muse-image-1.0", costUsd: 0.05 });
  });
});
