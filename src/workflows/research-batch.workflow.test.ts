import { http, HttpResponse } from "msw";
import { start } from "workflow/api";
import { gatewayHandlers } from "../../test/gateway/msw";
import { makePng } from "../../test/gateway/png";
import {
  errorBody,
  exaSearchResponse,
  promptFiles,
  promptHasImage,
  promptText,
  textResponse,
  type ParsedLanguageRequest,
} from "../../test/gateway/wire";
import { server } from "../../test/msw/server";
import { createPendingBatch, getPendingTool, queueForResearch } from "../lib/data/pending-tools";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { researchBatch } from "./research-batch";

/**
 * The one in-process `@workflow/vitest` run of `researchBatch` (spec §10): the
 * real workflow runtime, the real step bundle, the seeded PGlite database —
 * and one item the model provider refuses, which must end `failed` while the
 * others end `researched`, each with its product images ranked.
 *
 * `vi.mock()` does not reach step code at this tier (the 2026-09-22
 * amendment): steps load from a pre-built bundle through Node's own `import()`.
 * So the models are stubbed where the provider actually calls — the Vercel AI
 * Gateway's `/language-model` endpoint, in its own wire format
 * (`test/gateway/`) — with MSW, which does reach it. One handler answers every
 * model call, told apart by shape as the E2E stub does:
 *
 * - **search** — the tools include `exa_search`: Exa's results, already run by
 *   the "Gateway", then the findings;
 * - **image ranking** — the prompt carries images: a permutation of them;
 * - **read** — anything else: the drafted listing.
 *
 * The pages research reads, the images they declare and every link check are
 * answered by MSW too, and every host name resolves to a public address through
 * test/web/resolver.ts. No Blob store is configured, so the stage cuts no
 * background out (and a cutout never calls a model anyway). No key and no
 * network: the key is a stub.
 *
 * The step bundle has its own copy of `db/client.ts`, but that module keeps
 * its handle on `globalThis`, so calling `getDb()` here first means the steps
 * find this same PGlite database rather than building a second one.
 */

const REFUSED = "Laser Cutter That The Provider Refuses";

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const pageUrl = (name: string) => `https://maker.example/${slug(name)}`;
const manualUrl = (name: string) => `${pageUrl(name)}/manual.pdf`;
const imageUrl = (name: string, view: string) => `${pageUrl(name)}/${view}.png`;

/** A product page declaring three images: og, twitter and JSON-LD. */
function productPage(name: string): string {
  const jsonLd = JSON.stringify({ "@context": "https://schema.org", "@type": "Product", name, image: [imageUrl(name, "box")] });
  return `<!doctype html><html><head><title>${name}</title>
<meta property="og:image" content="${imageUrl(name, "front")}">
<meta name="twitter:image" content="${imageUrl(name, "side")}">
<script type="application/ld+json">${jsonLd}</script>
</head><body><main><h1>${name}</h1><p>A resin printer with a 120 V supply.</p></main></body></html>`;
}

const PDF = new TextEncoder().encode("%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n");
const PNG = makePng({ width: 1200, height: 900, alpha: false });

function findings(name: string) {
  return {
    canonicalName: name,
    description: "A machine.",
    category: { name: "Resin", group: "3D Printing" },
    candidateLinks: [{ title: "Manual", url: manualUrl(name), type: "Manual" }],
    sourceUrls: [pageUrl(name)],
    evidence: { userStatedModel: true, manufacturerPageFound: true },
  };
}

function draft(name: string) {
  return {
    canonicalName: name,
    description: "A machine, described from its manual.",
    specs: [{ label: "Power", value: "120 V" }],
    materials: ["Resin"],
    ppeRequired: ["Nitrile gloves"],
    tags: ["SLA"],
    trainingRequired: true,
    useRestrictions: null,
    category: { name: "Resin", group: "3D Printing" },
    resources: [{ title: "Manual", url: manualUrl(name), type: "Manual" }],
    sourceUrls: [pageUrl(name), manualUrl(name)],
    evidence: {
      userStatedModel: true,
      modelPlateRead: null,
      manufacturerPageFound: true,
      manualFound: true,
      specsFromSource: true,
      categoryOnly: false,
    },
  };
}

/** Best last: the ranking puts the images in reverse, so the order provably came from the model. */
function reverseRanking(req: ParsedLanguageRequest) {
  const count = promptFiles(req, "image/").length;
  const order = Array.from({ length: count }, (_, i) => count - 1 - i);
  return textResponse(
    JSON.stringify({ order, reasons: order.map((i) => `image ${i}`), images: order.map(() => ({ subject: "product" })) })
  );
}

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("researchBatch (in process)", () => {
  it("fails the item the provider refuses and researches the others, with their images", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "test-gateway-key");

    const suffix = crypto.randomUUID().slice(0, 6);
    const names = [`Workflow Printer A ${suffix}`, `${REFUSED} ${suffix}`, `Workflow Printer B ${suffix}`, `Workflow Mill ${suffix}`];
    const calls = { search: 0, read: 0, rank: 0 };

    server.use(
      ...gatewayHandlers({
        language: (req) => {
          if (promptHasImage(req)) {
            calls.rank += 1;
            return reverseRanking(req);
          }
          const prompt = promptText(req);
          const name = names.find((candidate) => prompt.includes(`Name: ${candidate}`));
          if (!name) return errorBody(404, "model_not_found", "no stubbed answer for this prompt");

          if (req.tools.some((tool) => tool.name === "exa_search")) {
            calls.search += 1;
            if (name.startsWith(REFUSED)) return errorBody(400, "invalid_request_error", "tool configuration rejected");
            return exaSearchResponse({
              query: name,
              results: [
                {
                  url: pageUrl(name),
                  title: name,
                  highlights: ["A resin printer."],
                  image: `https://cdn.reviews.example/${slug(name)}.jpg`,
                  imageLinks: [`https://cdn.reviews.example/${slug(name)}-2.jpg`],
                },
              ],
              text: JSON.stringify(findings(name)),
            });
          }
          calls.read += 1;
          return textResponse(`Here is the listing:\n${JSON.stringify(draft(name))}`);
        },
      }),
      http.get("https://maker.example/*", ({ request }) => {
        const path = new URL(request.url).pathname;
        if (path.endsWith(".pdf")) {
          return HttpResponse.arrayBuffer(PDF.slice().buffer, { headers: { "content-type": "application/pdf" } });
        }
        if (path.endsWith(".png")) {
          return HttpResponse.arrayBuffer(PNG.slice().buffer, { headers: { "content-type": "image/png" } });
        }
        const name = names.find((candidate) => path === `/${slug(candidate)}`);
        return name ? HttpResponse.html(productPage(name)) : new HttpResponse(null, { status: 404 });
      })
    );

    const { items } = await createPendingBatch({
      createdBy: DEMO_ACCOUNTS.admin.id,
      items: names.map((name) => ({ name })),
    });
    const ids = items.map((item) => item.id);
    const requestId = crypto.randomUUID();
    expect(await queueForResearch(ids, { requestedBy: DEMO_ACCOUNTS.admin.id, requestId })).toEqual(ids);

    const run = await start(researchBatch, [requestId, ids]);
    expect(await run.returnValue).toEqual({ researched: 3, failed: 1 });

    const rows = await Promise.all(ids.map((id) => getPendingTool(id)));
    const refused = rows.find((row) => row?.name.startsWith(REFUSED));
    expect(refused?.status).toBe("failed");
    // The classified message, as `errors.ts` wrote it — the diagnosis record.
    expect(refused?.researchError).toMatch(/^Research \(search\):/);
    expect(refused?.research).toBeNull();

    for (const row of rows.filter((candidate) => candidate !== refused)) {
      const name = row!.name;
      expect(row?.status).toBe("researched");
      expect(row?.research?.confidence.level).toBe("high");
      expect(row?.research?.resources).toHaveLength(1);
      expect(row?.research?.category.existingId).not.toBeNull();
      // The page's three images, probed and ranked (reversed by the stub), no clean without Blob.
      expect(row?.research?.images).toEqual({
        candidates: [
          expect.objectContaining({ url: imageUrl(name, "box"), source: "jsonld", rank: 1, width: 1200, height: 900, pageUrl: pageUrl(name) }),
          expect.objectContaining({ url: imageUrl(name, "side"), source: "twitter", rank: 2 }),
          expect.objectContaining({ url: imageUrl(name, "front"), source: "og", rank: 3 }),
        ],
        cleaned: null,
      });
      expect(row?.research?.imageError).toBeNull();
    }
    expect(calls.rank).toBe(3);
  });
});
