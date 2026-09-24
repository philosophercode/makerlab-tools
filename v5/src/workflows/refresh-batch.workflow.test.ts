import { http, HttpResponse } from "msw";
import { start } from "workflow/api";
import { gatewayHandlers } from "../../test/gateway/msw";
import { makePng } from "../../test/gateway/png";
import { errorBody, exaSearchResponse, promptFiles, promptHasImage, promptText, textResponse, type ParsedLanguageRequest } from "../../test/gateway/wire";
import { server } from "../../test/msw/server";
import { getRefresh, queueRefreshesWithinAllowance } from "../lib/data/tool-refreshes";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { tools } from "../lib/db/schema/index";
import { refreshBatch } from "./refresh-batch";

/**
 * The in-process `@workflow/vitest` run of `refreshBatch` (refresh research
 * spec §10 "The workflow"): the real workflow runtime, the real step bundle,
 * the seeded PGlite database, and the models stubbed at the Gateway's wire.
 *
 * Three tools: one research identifies (proposals stored, quotes checked in
 * code, a safety differs among them, images ranked because it has no cover),
 * one the provider refuses (`failed`, with the classified reason), and one
 * research cannot identify (`floor_check` only). The search prompt of the
 * first is checked for blindness: its hand-typed description never reaches it.
 */

const RUN = crypto.randomUUID().slice(0, 6);
const KNOWN = `Refresh Dust Collector ${RUN}`;
const REFUSED = `Refresh Refused Laser ${RUN}`;
const UNKNOWN = `Refresh Grey Box ${RUN}`;
const TYPED_DESCRIPTION = `Hand-typed ${RUN}: rated for 1-micron filtration.`;

const PAGE = `https://dust.example/${RUN}/dc3401`;
const IMAGE = `https://dust.example/${RUN}/front.png`;
const PAGE_HTML = `<!doctype html><html><head><title>DC3401</title><meta property="og:image" content="${IMAGE}"></head>
<body><main><h1>DC3401 Air Filtration</h1><p>Filters particles down to 5 microns.</p><p>Not for use with flammable dust.</p></main></body></html>`;
const PNG = makePng({ width: 1200, height: 900, alpha: false });

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

function ranking(req: ParsedLanguageRequest) {
  const count = promptFiles(req, "image/").length;
  const order = Array.from({ length: count }, (_, i) => i);
  return textResponse(JSON.stringify({ order, reasons: order.map((i) => `image ${i}`) }));
}

describe("refreshBatch (in process)", () => {
  it("stores proposals, fails the refused tool, and gives the unidentified one a floor check", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");
    const searchPrompts = new Map<string, string>();

    server.use(
      ...gatewayHandlers({
        language: (req) => {
          if (promptHasImage(req)) return ranking(req);
          const prompt = promptText(req);
          const name = [KNOWN, REFUSED, UNKNOWN].find((candidate) => prompt.includes(`Name: ${candidate}`));
          if (!name) return errorBody(404, "model_not_found", "no stubbed answer for this prompt");

          if (req.tools.some((tool) => tool.name === "exa_search")) {
            searchPrompts.set(name, prompt);
            if (name === REFUSED) return errorBody(400, "invalid_request_error", "tool configuration rejected");
            const findings =
              name === KNOWN
                ? { canonicalName: "WEN DC3401", candidateLinks: [{ title: "DC3401", url: PAGE, type: "Other" }], sourceUrls: [PAGE], evidence: { manufacturerPageFound: true } }
                : { canonicalName: "", candidateLinks: [], sourceUrls: [], evidence: { categoryOnly: true } };
            return exaSearchResponse({ query: name, results: [], text: JSON.stringify(findings) });
          }
          return textResponse(
            JSON.stringify({
              canonicalName: "WEN DC3401",
              description: "An air filtration system that filters particles down to 5 microns.",
              specs: [{ label: "Filtration", value: "5 microns" }],
              materials: [],
              ppeRequired: ["Respirator"],
              tags: ["Dust collection"],
              trainingRequired: null,
              useRestrictions: "Not for use with flammable dust.",
              emergencyStop: null,
              category: { name: "Dust Collection", group: null },
              resources: [],
              sourceUrls: [PAGE],
              evidence: { userStatedModel: true, manufacturerPageFound: true, specsFromSource: true },
              citations: {
                useRestrictions: [{ quote: "Not for use with flammable dust.", url: PAGE }],
                description: [{ quote: "Filters particles down to 1 micron.", url: PAGE }],
              },
            })
          );
        },
      }),
      http.get(IMAGE, () => HttpResponse.arrayBuffer(PNG.slice().buffer, { headers: { "content-type": "image/png" } })),
      http.get(PAGE, () => HttpResponse.html(PAGE_HTML))
    );

    const db = await getDb();
    const inserted = await db
      .insert(tools)
      .values([
        { name: KNOWN, slug: `refresh-known-${RUN}`, description: TYPED_DESCRIPTION, useRestrictions: "Rated for 1-micron filtration.", published: true },
        { name: REFUSED, slug: `refresh-refused-${RUN}`, published: true },
        { name: UNKNOWN, slug: `refresh-unknown-${RUN}`, published: true },
      ])
      .returning({ id: tools.id, name: tools.name });
    const requestId = crypto.randomUUID();
    const queued = await queueRefreshesWithinAllowance(
      inserted.map((row) => row.id),
      { requestedBy: DEMO_ACCOUNTS.admin.id, requestId, limit: 1000, since: new Date(0), note: null, includeDescription: false }
    );
    if (!queued.ok) throw new Error("unreachable");
    const refreshOf = (name: string) => queued.queued[inserted.findIndex((row) => row.name === name)].refreshId;

    const run = await start(refreshBatch, [requestId, queued.queued.map((row) => row.refreshId)]);
    expect(await run.returnValue).toEqual({ proposed: 2, failed: 1 });

    // Blind: the search was told the name, never the record's description or restriction.
    expect(searchPrompts.get(KNOWN)).toContain(KNOWN);
    expect(searchPrompts.get(KNOWN)).not.toContain(TYPED_DESCRIPTION);
    expect(searchPrompts.get(KNOWN)).not.toContain("1-micron");

    const known = await getRefresh(refreshOf(KNOWN));
    expect(known?.status).toBe("proposed");
    const restriction = known?.proposals?.find((p) => p.field === "use_restrictions");
    expect(restriction).toMatchObject({
      kind: "differs",
      safety: true,
      current: "Rated for 1-micron filtration.",
      proposed: "Not for use with flammable dust.",
      citations: [{ quote: "Not for use with flammable dust.", url: PAGE, verified: true }],
    });
    // The invented quote is kept, and marked as not found.
    expect(known?.research?.citations?.description?.[0]).toMatchObject({ verified: false });
    // No PPE proposal, whatever the model said; the result carries none either.
    expect(known?.proposals?.some((p) => (p.field as string) === "ppe_required")).toBe(false);
    expect(known?.research?.ppeRequired).toEqual([]);
    // No cover photo: the image stage ranked the page's image; nothing was stored.
    expect(known?.proposals?.find((p) => p.field === "cover_photo")).toMatchObject({ kind: "new", proposed: { url: IMAGE } });
    expect(known?.research?.images?.cleaned).toBeNull();

    const refused = await getRefresh(refreshOf(REFUSED));
    expect(refused).toMatchObject({ status: "failed", proposals: null });
    expect(refused?.researchError).toMatch(/^Research \(search\):/);

    const unknown = await getRefresh(refreshOf(UNKNOWN));
    expect(unknown?.status).toBe("proposed");
    expect(unknown?.proposals?.map((p) => p.field)).toEqual(["floor_check"]);
  });
});
