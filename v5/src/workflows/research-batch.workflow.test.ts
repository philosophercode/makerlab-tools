import { http, HttpResponse } from "msw";
import { start } from "workflow/api";
import { server } from "../../test/msw/server";
import { createPendingBatch, getPendingTool, queueForResearch } from "../lib/data/pending-tools";
import { getDb, resetDbForTests } from "../lib/db/client";
import { DEMO_ACCOUNTS } from "../lib/db/demo-seed";
import { researchBatch } from "./research-batch";

/**
 * The one in-process `@workflow/vitest` run of `researchBatch` (spec §10): the
 * real workflow runtime, the real step bundle, the seeded PGlite database —
 * and one item the model provider refuses, which must end `failed` while the
 * others end `researched`.
 *
 * `vi.mock()` does not reach step code at this tier (the 2026-09-22
 * amendment): steps load from a pre-built bundle through Node's own `import()`.
 * So the model is stubbed where the provider actually calls —
 * `https://api.anthropic.com/v1/messages`, the default path in `model.ts` —
 * with MSW, which does reach it, and every link check is answered the same
 * way. No key and no network: the key is a stub.
 *
 * The step bundle has its own copy of `db/client.ts`, but that module keeps
 * its handle on `globalThis`, so calling `getDb()` here first means the steps
 * find this same PGlite database rather than building a second one.
 */

const ANTHROPIC_MESSAGES = "https://api.anthropic.com/v1/messages";

interface MessagesRequest {
  messages: { role: string; content: string | { type: string; text?: string }[] }[];
  tools?: { type: string; name: string }[];
}

function promptText(body: MessagesRequest): string {
  return body.messages
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => part.text ?? "").join("\n")
    )
    .join("\n");
}

function message(text: string) {
  return HttpResponse.json({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-sonnet-4-6",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 10 },
  });
}

function slug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
}

const REFUSED = "Laser Cutter That The Provider Refuses";

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  await getDb();
});

afterAll(() => {
  resetDbForTests();
});

describe("researchBatch (in process)", () => {
  it("fails the item the provider refuses and researches the others", { timeout: 120_000 }, async () => {
    vi.stubEnv("DATABASE_URL", "");
    vi.stubEnv("AI_GATEWAY_API_KEY", "");
    vi.stubEnv("ANTHROPIC_API_KEY", "test-anthropic-key");

    const suffix = crypto.randomUUID().slice(0, 6);
    const names = [`Workflow Printer A ${suffix}`, `${REFUSED} ${suffix}`, `Workflow Printer B ${suffix}`, `Workflow Mill ${suffix}`];

    server.use(
      http.post(ANTHROPIC_MESSAGES, async ({ request }) => {
        const body = (await request.json()) as MessagesRequest;
        const prompt = promptText(body);
        const name = names.find((candidate) => prompt.includes(`Name: ${candidate}`));
        if (!name) return HttpResponse.json({ type: "error", error: { type: "not_found_error" } }, { status: 404 });

        if (name.startsWith(REFUSED)) {
          return HttpResponse.json(
            { type: "error", error: { type: "invalid_request_error", message: "tool configuration rejected" } },
            { status: 400 }
          );
        }

        const manual = `https://maker.example/${slug(name)}/manual.pdf`;
        const isSearch = (body.tools ?? []).some((tool) => tool.name === "web_search");
        if (isSearch) {
          return message(
            JSON.stringify({
              canonicalName: name,
              description: "A machine.",
              category: { name: "Resin", group: "3D Printing" },
              candidateLinks: [{ title: "Manual", url: manual, type: "Manual" }],
              sourceUrls: [`https://maker.example/${slug(name)}`],
              evidence: { userStatedModel: true, manufacturerPageFound: true },
            })
          );
        }
        return message(
          `Here is the listing:\n${JSON.stringify({
            canonicalName: name,
            description: "A machine, described from its manual.",
            specs: [{ label: "Power", value: "120 V" }],
            materials: ["Resin"],
            ppeRequired: ["Nitrile gloves"],
            tags: ["SLA"],
            trainingRequired: true,
            useRestrictions: null,
            category: { name: "Resin", group: "3D Printing" },
            resources: [{ title: "Manual", url: manual, type: "Manual" }],
            sourceUrls: [`https://maker.example/${slug(name)}`, manual],
            evidence: {
              userStatedModel: true,
              modelPlateRead: null,
              manufacturerPageFound: true,
              manualFound: true,
              specsFromSource: true,
              categoryOnly: false,
            },
          })}`
        );
      }),
      http.get("https://maker.example/*", () => new HttpResponse("%PDF", { status: 200 }))
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
    expect(refused?.researchError).toMatch(/^Research \(search\): the model provider refused the request \(HTTP 400\)/);
    expect(refused?.research).toBeNull();

    for (const row of rows.filter((candidate) => candidate !== refused)) {
      expect(row?.status).toBe("researched");
      expect(row?.research?.confidence.level).toBe("high");
      expect(row?.research?.resources).toHaveLength(1);
      expect(row?.research?.category.existingId).not.toBeNull();
    }
  });
});
