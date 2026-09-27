// @vitest-environment node
/* eslint-disable @typescript-eslint/no-explicit-any -- reads the loosely-typed
   prompt and tool results a stub model recorded. */

// The chat model and the embedding model are stubbed at the job registry
// (`test/ai/models-stub.ts`); the route, the tools and the search run for real
// against the demo-seeded PGlite database, with pgvector.
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

const mocks = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: mocks.checkRateLimit, getClientIp: vi.fn(() => "1.2.3.4") };
});
vi.mock("next/cache", () => ({ cacheTag: vi.fn(), cacheLife: vi.fn(), revalidateTag: vi.fn() }));

import { eq, inArray } from "drizzle-orm";
import { http, HttpResponse } from "msw";
import { POST } from "@/app/api/chat/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { attachments, resources, tools as toolsTable } from "@/lib/db/schema/index";
import { buildDocumentPassages } from "@/lib/manuals/passages";
import { fakeEmbeddingTarget } from "../../../../test/ai/fake-embeddings";
import {
  recordedCalls,
  resetModelStubs,
  setEmbeddingModel,
  setLanguageModel,
  textModel,
  toolCallModel,
  type RecordedCall,
} from "../../../../test/ai/models-stub";
import { seedManual, type SeedManualInput } from "../../../../test/manuals/seed";
import { server } from "../../../../test/msw/server";
import { signInAsNew } from "../../../../test/utils/session";

/**
 * Manual search in the chat (manual text spec §3.6, phase 2): `search_manual`
 * is offered and answers with page citations; a searchable manual's contents
 * are in the prompt and it is never attached; whole-PDF attachment is the
 * fallback only for manuals not processed (and only those count against the
 * cap); and access holds — a private SOP never reaches an anonymous search.
 */

const target = fakeEmbeddingTarget();
const inserted: string[] = [];
let model = textModel("Hello.");

function stubChat(next: typeof model) {
  model = next;
  setLanguageModel("chat", next);
}

const userMessage = (text: string) => ({ id: "1", role: "user" as const, parts: [{ type: "text" as const, text }] });

async function send(body: Record<string, unknown>, headers: Record<string, string> = {}) {
  const res = await POST(
    new Request("http://localhost/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "1.2.3.4", ...headers },
      body: JSON.stringify(body),
    })
  );
  return res.text();
}

function firstCall(): RecordedCall {
  const [call] = recordedCalls(model);
  if (!call) throw new Error("the chat model was never called");
  return call;
}

function systemOf(): string {
  const message = firstCall().prompt.find((m) => m.role === "system");
  return typeof message?.content === "string" ? message.content : "";
}

function toolResult(name: string): any {
  const toolMessage: any = recordedCalls(model)[1]?.prompt.find((m) => m.role === "tool");
  const part = toolMessage?.content.find((p: any) => p.type === "tool-result" && p.toolName === name);
  if (!part) throw new Error(`no ${name} result reached the model`);
  return part.output.type === "json" ? part.output.value : part.output;
}

function fileParts(): any[] {
  const user: any = firstCall().prompt.find((m) => m.role === "user");
  return (user.content as any[]).filter((p) => p.type === "file");
}

async function toolIdOf(slug: string): Promise<string> {
  const db = await getDb();
  const [row] = await db.select({ id: toolsTable.id }).from(toolsTable).where(eq(toolsTable.slug, slug));
  return row.id;
}

/** A processed (searchable) manual on `slug`. */
async function searchableManual(slug: string, input: Omit<SeedManualInput, "toolId">) {
  const db = await getDb();
  const seeded = await seedManual(db, { toolId: await toolIdOf(slug), ...input });
  inserted.push(seeded.resourceId);
  expect((await buildDocumentPassages(db, seeded.documentId, { target })).status).toBe("built");
  return seeded;
}

const PAGES = [
  "Cleaning the build platform. Wipe the platform with isopropyl alcohol after every print.",
  "Replacing the resin tank. Lift the resin tank straight up and set it on a flat surface.",
];
const OUTLINE = [
  { title: "Cleaning", page: 1, level: 1 },
  { title: "Resin tank", page: 2, level: 1 },
];

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  stubChat(textModel("Hello."));
  setEmbeddingModel(target.model);
  mocks.checkRateLimit.mockResolvedValue({
    allowed: true,
    remaining: 59,
    limit: 60,
    windowMs: 3_600_000,
    retryAfterSeconds: 3600,
    role: "user",
  });
});

afterEach(async () => {
  resetModelStubs();
  vi.restoreAllMocks();
  const db = await getDb();
  await db.delete(attachments);
  if (inserted.length) await db.delete(resources).where(inArray(resources.id, inserted.splice(0)));
});

afterAll(() => resetDbForTests());

describe("search_manual in the chat", () => {
  it("is offered to everyone, and its prompt says to cite pages and to say when the manual does not cover it", async () => {
    await send({ messages: [userMessage("hi")] });
    expect(firstCall().tools?.map((t) => t.name)).toContain("search_manual");
    const system = systemOf();
    expect(system).toContain("## Searching manuals");
    expect(system).toContain("say the manual does not cover it");
    expect(system).toContain("<untrusted-page>");
  });

  it("puts a searchable manual's contents in the prompt on its tool page, and never attaches it", async () => {
    const seeded = await searchableManual("form-4", { title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    const fetched: string[] = [];
    server.use(http.get(`${seeded.publicUrl}`, ({ request }) => (fetched.push(request.url), HttpResponse.error())));

    await send({ messages: [userMessage("how do I change the tank")], toolId: "form-4" });

    const system = systemOf();
    expect(system).toContain("## Manuals for the Form 4 (searchable)");
    expect(system).toContain("- Resin tank — p. 2");
    expect(fetched).toEqual([]);
    expect(fileParts()).toEqual([]);
    expect(system).not.toContain("## Available manuals");
  });

  it("answers with passages carrying the page citation and a #page link, fenced as untrusted", async () => {
    const seeded = await searchableManual("form-4", { title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "replace the resin tank" } }], "Done."));

    await send({ messages: [userMessage("how do I replace the resin tank")], toolId: "form-4" });

    const result = toolResult("search_manual");
    expect(result).toMatchObject({ status: "ok", scope: "Form 4 manuals" });
    expect(result.passages[0]).toMatchObject({
      citation: "Form 4 Manual, p. 2",
      url: `${seeded.publicUrl}#page=2`,
      tool: "Form 4",
      section: "Resin tank",
    });
    expect(result.passages[0].text).toMatch(/^<untrusted-page id="[0-9a-f]+" source="Form 4 Manual, p\. 2">/);
    expect(result.passages[0].text).toContain("Lift the resin tank");
  });

  it("scopes to a named machine, refuses an unknown one, and says when nothing matches", async () => {
    await searchableManual("form-4", { title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    await searchableManual("trotec-speedy-400", {
      title: "Speedy 400 Manual",
      pages: ["Cleaning the lens. Remove the lens holder and wipe the resin tank of the laser."],
    });

    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "resin tank", tool: "Trotec Speedy 400" } }], "ok"));
    await send({ messages: [userMessage("q")] });
    const scoped = toolResult("search_manual");
    expect(scoped.scope).toBe("Trotec Speedy 400 manuals");
    expect(new Set(scoped.passages.map((p: any) => p.tool))).toEqual(new Set(["Trotec Speedy 400"]));

    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "resin", tool: "Glowforge Pro" } }], "ok"));
    await send({ messages: [userMessage("q")] });
    expect(toolResult("search_manual")).toMatchObject({ status: "unknown_tool" });

  });

  it("says so when the tool has no searchable manual (vector search always has a nearest passage otherwise)", async () => {
    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "warranty terms" } }], "ok"));
    await send({ messages: [userMessage("q")], toolId: "form-4" });
    expect(toolResult("search_manual")).toMatchObject({ status: "no_results", scope: "Form 4 manuals" });
    expect(toolResult("search_manual").message).toContain("does not cover it");
  });

  it("never lets a private SOP reach an anonymous search, and gives it to lab staff", async () => {
    await searchableManual("form-4", {
      title: "Internal SOP",
      pages: ["Staff only: the resin tank torque setting is 12 Nm."],
      access: "private",
    });
    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "resin tank torque" } }], "ok"));
    await send({ messages: [userMessage("q")], toolId: "form-4" });
    expect(toolResult("search_manual")).toMatchObject({ status: "no_results" });
    expect(systemOf()).not.toContain("Internal SOP");

    vi.stubEnv("AUTH_SECRET", "manual-search-test-secret");
    resetAuthForTests();
    const { cookie } = await signInAsNew({ role: "admin", name: "Niti" });
    stubChat(toolCallModel([{ toolName: "search_manual", input: { query: "resin tank torque" } }], "ok"));
    await send({ messages: [userMessage("q")], toolId: "form-4" }, { cookie });
    const result = toolResult("search_manual");
    expect(result.status).toBe("ok");
    expect(result.passages[0]).toMatchObject({ citation: "Internal SOP, p. 1", url: null });
    expect(systemOf()).toContain("### Internal SOP");
  });
});

describe("whole-PDF attachment is only the fallback", () => {
  it("attaches an unprocessed manual beside a searchable one, and only the unprocessed count against the cap", async () => {
    await searchableManual("form-4", { title: "Form 4 Manual", pages: PAGES, outline: OUTLINE });
    const db = await getDb();
    const formId = await toolIdOf("form-4");
    const links = [1, 2, 3, 4].map((n) => `https://x.test/raw-${n}.pdf`);
    const created = await db
      .insert(resources)
      .values(links.map((url, n) => ({ toolId: formId, title: `Raw ${n + 1}`, type: "Manual", url })))
      .returning({ id: resources.id });
    inserted.push(...created.map((row) => row.id));
    const hits: string[] = [];
    server.use(
      ...links.map((url) =>
        http.get(url, ({ request }) => {
          hits.push(request.url);
          return HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-1.4\n").buffer, {
            headers: { "content-type": "application/pdf" },
          });
        })
      )
    );

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    // Three unprocessed manuals attached (the cap), the searchable one not among them.
    expect(fileParts().map((p) => p.filename)).toEqual(["Raw 1.pdf", "Raw 2.pdf", "Raw 3.pdf"]);
    expect(hits).toHaveLength(3);
    expect(systemOf()).toContain("## Manuals for the Form 4 (searchable)");
    expect(systemOf()).toContain("## Available manuals");
  });

  it("attaches a manual whose text has no passages yet (ready, embedding pending) and one that is no_text", async () => {
    const db = await getDb();
    const formId = await toolIdOf("form-4");
    const pending = await seedManual(db, { toolId: formId, title: "Pending Manual", pages: PAGES });
    const scan = await seedManual(db, { toolId: formId, title: "Scanned Manual", pages: ["", ""], status: "no_text" });
    inserted.push(pending.resourceId, scan.resourceId);
    server.use(
      ...[pending.publicUrl, scan.publicUrl].map((url) =>
        http.get(`${url}`, () =>
          HttpResponse.arrayBuffer(new TextEncoder().encode("%PDF-1.4\n").buffer, { headers: { "content-type": "application/pdf" } })
        )
      )
    );

    await send({ messages: [userMessage("help")], toolId: "form-4" });

    expect(fileParts().map((p) => p.filename).sort()).toEqual(["Pending Manual.pdf", "Scanned Manual.pdf"]);
    expect(systemOf()).not.toContain("(searchable)");
  });
});
