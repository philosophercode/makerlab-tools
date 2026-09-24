import { start } from "workflow/api";
import { gatewayHandlers } from "../../test/gateway/msw";
import { errorBody, exaSearchResponse, promptText, textResponse } from "../../test/gateway/wire";
import { server } from "../../test/msw/server";
import { createBulkImport, getBulkImport } from "../lib/data/bulk-imports";
import { getPendingTool, listPendingTools } from "../lib/data/pending-tools";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { chunkDocument } from "../lib/import/extract-output";
import { importDocument } from "./import-document";
import { suggestNames } from "./suggest-names";
import { addImportItems } from "../lib/data/bulk-imports";

/**
 * The in-process `@workflow/vitest` runs of bulk intake's two workflows (bulk
 * intake spec §3.2, §3.3), against the seeded PGlite database with the models
 * stubbed at the Gateway's wire.
 *
 * - `importDocument`: a two-part document, one part read, one the provider
 *   refuses — the rows from the part that was read are written, in order, as
 *   identified pending items; a document naming nothing fails as `no_items`.
 * - `suggestNames`: one Exa-backed answer per item, stored on the row; the
 *   search is told the name and brand, never the row's notes.
 */

const RUN = crypto.randomUUID().slice(0, 6);

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

function documentOfTwoParts(): string {
  const filler = Array.from({ length: 220 }, (_, i) => `Line ${i}: general notes about the room and its benches.`).join("\n");
  return `Inventory ${RUN}\nLaser room: Trotec Speedy 400 (serviced March)\n${filler}\nWood shop: Drill master heat gun, two of them\n`;
}

describe("importDocument (in process)", () => {
  it("writes the rows a readable part named, and leaves out the part the provider refused", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    const text = documentOfTwoParts();
    const { chunks } = chunkDocument(text);
    expect(chunks.length).toBe(2);

    const prompts: string[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req) => {
          const prompt = promptText(req);
          prompts.push(prompt);
          if (prompt.includes("part 2 of 2")) return errorBody(400, "invalid_request_error", "refused");
          return textResponse(
            JSON.stringify({
              items: [
                { name: `Trotec Speedy 400 ${RUN}`, brand: "Trotec", notes: "serviced March", location: "Laser room" },
                { name: `Ferrari ${RUN}`, notes: "consumable?" },
              ],
            })
          );
        },
      })
    );

    const created = await createBulkImport({
      createdBy: DEMO_ACCOUNTS.admin.id,
      sourceKind: "document",
      format: "document",
      sourceName: `wiki-${RUN}.md`,
      sourceText: text,
      status: "parsing",
    });
    const run = await start(importDocument, [created.id, chunks.length]);
    expect(await run.returnValue).toEqual({ items: 2, failedChunks: 1 });

    // No tools, flex, and the text fenced as untrusted.
    expect(prompts.every((prompt) => prompt.includes("<untrusted-page"))).toBe(true);

    const found = await getBulkImport(created.id);
    expect(found).toMatchObject({ status: "ready", itemCount: 2 });
    const rows = await listPendingTools({ importId: created.id });
    expect(rows.map((row) => row.name).sort()).toEqual([`Ferrari ${RUN}`, `Trotec Speedy 400 ${RUN}`]);
    for (const row of rows) expect(row.status).toBe("identified");
  });

  it("fails as no_items when the document names no equipment", { timeout: 60_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    server.use(...gatewayHandlers({ language: () => textResponse('{"items": []}') }));

    const created = await createBulkImport({
      createdBy: DEMO_ACCOUNTS.admin.id,
      sourceKind: "document",
      format: "document",
      sourceName: null,
      sourceText: `Meeting notes ${RUN}: we should tidy the shelves.`,
      status: "parsing",
    });
    const run = await start(importDocument, [created.id, 1]);
    expect(await run.returnValue).toEqual({ items: 0, failedChunks: 0 });
    expect(await getBulkImport(created.id)).toMatchObject({ status: "failed", parseError: "no_items" });
  });
});

describe("suggestNames (in process)", () => {
  it("stores one suggestion per identified item, from the name and brand only", { timeout: 60_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    const prompts: string[] = [];
    server.use(
      ...gatewayHandlers({
        language: (req) => {
          prompts.push(promptText(req));
          return exaSearchResponse({
            query: "Form 2",
            results: [{ url: "https://formlabs.example/form-2", title: "Form 2", highlights: ["Formlabs Form 2 SLA printer"] }],
            text: JSON.stringify({
              canonicalName: `Formlabs Form 2 ${RUN}`,
              brand: "Formlabs",
              confidence: "exact",
              sourceUrl: "https://formlabs.example/form-2",
            }),
          });
        },
      })
    );

    const created = await createBulkImport({
      createdBy: DEMO_ACCOUNTS.admin.id,
      sourceKind: "paste",
      format: "list",
      sourceName: null,
      sourceText: "Form 2",
      status: "parsing",
    });
    const written = await addImportItems(created.id, {
      items: [
        {
          name: `Form 2 ${RUN}`,
          brand: null,
          categoryHint: null,
          locationHint: null,
          quantity: 1,
          serials: [],
          notes: `Ask Niti Parikh ${RUN}`,
          links: [],
          labDocs: [],
          sourceRow: 1,
        },
      ],
      rowCount: 1,
    });
    if (!written.ok) throw new Error("rows not written");
    const [id] = written.itemIds;

    const run = await start(suggestNames, [crypto.randomUUID(), [id]]);
    expect(await run.returnValue).toEqual({ suggested: 1, failed: 0 });
    expect((await getPendingTool(id))?.nameSuggestion).toMatchObject({
      canonicalName: `Formlabs Form 2 ${RUN}`,
      confidence: "exact",
    });
    // §8 PII: the notes never reach the search.
    expect(prompts.join("\n")).not.toContain("Niti Parikh");
  });
});
