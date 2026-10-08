import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { start } from "workflow/api";
import { gatewayHandlers } from "../../test/gateway/msw";
import { promptText, textResponse } from "../../test/gateway/wire";
import { server } from "../../test/msw/server";
import { getDb, resetDbForTests } from "../lib/db/client";
import { manualChunks, manualDocuments, manualEvalQuestions, manualPages, resources, tools } from "../lib/db/schema/index";
import { CHUNKER_VERSION } from "../lib/manuals/chunk";
import { archiveManuals } from "./archive-manuals";

/**
 * `archiveManuals` in process under `@workflow/vitest` (manual text spec §10
 * "Workflow: archive → index runs once"): the real step bundle archives a
 * manual PDF served by MSW into a temporary local Blob folder, then the index
 * step reads it back and stores its text. A second run changes nothing.
 * Then the eval questions step writes the manual's questions (amendment
 * 2026-10-07) through the Gateway's language endpoint, stubbed too, once.
 */

const LINK = "https://maker.test/acme-laser-40-manual.pdf";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("archiveManuals (in process)", () => {
  it("archives a manual and processes it into text, once", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
    vi.stubEnv("BLOB_LOCAL_DISABLE", "");
    vi.stubEnv("BLOB_LOCAL_DIR", mkdtempSync(join(tmpdir(), "archive-manuals-wf-")));
    for (const method of ["info", "warn"] as const) vi.spyOn(console, method).mockImplementation(() => {});

    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    vi.stubEnv("MODEL_EMBED", "");
    vi.stubEnv("MODEL_EVAL_QUESTIONS", "");
    vi.stubEnv("MANUAL_EVAL_QUESTIONS", "");

    const pdf = new Uint8Array(readFileSync(join(process.cwd(), "test/fixtures/manuals/outline.pdf")));
    // Phase 2: the index step embeds the passages through the Gateway (job
    // `embed`), stubbed at its wire format — `vi.mock` does not reach step code.
    const embedded: string[][] = [];
    const asked: string[] = [];
    server.use(
      http.get(LINK, () => HttpResponse.arrayBuffer(pdf.slice().buffer, { headers: { "content-type": "application/pdf" } })),
      ...gatewayHandlers({
        embedding: (req) => {
          embedded.push(req.values);
          expect(req.modelId).toBe("openai/text-embedding-3-small");
          expect(req.providerOptions).toEqual({ openai: { dimensions: 512 } });
          return {
            embeddings: req.values.map((_, i) => Array.from({ length: 512 }, (_, d) => (d === i % 512 ? 1 : 0))),
            usage: { tokens: 10 * req.values.length },
            providerMetadata: { gateway: { cost: "0.00001" } },
          };
        },
        // The eval questions step (job `evalQuestions`, flex): one question from the first passage offered.
        language: (req) => {
          asked.push(req.modelId);
          expect(promptText(req)).toContain("P1");
          return textResponse(
            JSON.stringify({
              questions: [{ passage: "P1", question: "What can I cut on this laser?", answer: "Wood, acrylic, card and fabric.", answerable_from_passage: true }],
            })
          );
        },
      })
    );

    const db = await getDb();
    const [tool] = await db.select({ id: tools.id }).from(tools).limit(1);
    const [resource] = await db
      .insert(resources)
      .values({ toolId: tool.id, title: "Acme Laser 40 manual", type: "Manual", url: LINK })
      .returning({ id: resources.id });

    const first = await (await start(archiveManuals, [[resource.id]])).returnValue;
    expect(first).toEqual({ archived: 1, skipped: 0, failed: 0, indexed: 1, indexFailed: 0, passagesBuilt: 1, passagesFailed: 0, questionsWritten: 1, questionsFailed: 0, skillsWritten: 0, skillsFailed: 0 });

    const docs = await db.select().from(manualDocuments).where(eq(manualDocuments.toolId, tool.id));
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({
      title: "Acme Laser 40 manual",
      status: "ready",
      pageCount: 4,
      outlineSource: "pdf",
      chunkerVersion: CHUNKER_VERSION,
      embeddingModel: "openai/text-embedding-3-small@512",
    });
    expect(await db.select().from(manualPages).where(eq(manualPages.documentId, docs[0].id))).toHaveLength(4);
    const chunks = await db.select().from(manualChunks).where(eq(manualChunks.documentId, docs[0].id));
    expect(chunks.length).toBeGreaterThan(0);
    expect(embedded.flat()).toHaveLength(chunks.length);

    const second = await (await start(archiveManuals, [[resource.id]])).returnValue;
    expect(second).toEqual({ archived: 0, skipped: 1, failed: 0, indexed: 0, indexFailed: 0, passagesBuilt: 0, passagesFailed: 0, questionsWritten: 0, questionsFailed: 0, skillsWritten: 0, skillsFailed: 0 });
    expect(await db.select().from(manualDocuments).where(eq(manualDocuments.toolId, tool.id))).toHaveLength(1);
    // Idempotent: nothing embedded twice.
    expect(embedded.flat()).toHaveLength(chunks.length);

    // One call for the questions, on the first run only; stored with the page they came from.
    expect(asked).toEqual(["openai/gpt-6-luna"]);
    const stored = await db.select().from(manualEvalQuestions).where(eq(manualEvalQuestions.documentId, docs[0].id));
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ question: "What can I cut on this laser?", toolId: tool.id, model: "openai/gpt-6-luna" });
    expect(stored[0].expectedPages.length).toBeGreaterThan(0);
  });
});
