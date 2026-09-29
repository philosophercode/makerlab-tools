import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { http, passthrough } from "msw";
import { nextCacheMock } from "../test/mocks/next-cache";
import { server as msw } from "../test/msw/server";
import { attachManualsToFirstUserMessage } from "@/lib/chat/attached-manuals";
import { getNotionEnvContract } from "@/lib/notion";
import type { EvalCase } from "./cases";
import { caseMessages, composeCase } from "./harness";
import { startLocalBlobServer, type LocalBlobServer } from "./local-blob-server";
import { EVAL_ATTACHED_TITLE, seedEvalAttachedManual } from "./manual-fixture";

vi.mock("next/cache", () => nextCacheMock());

/**
 * The harness attaches a tool's unsearchable manual exactly as the chat route
 * does (`lib/chat/attached-manuals.ts`) and captures what the route streams
 * about it as `data-manual-links` — title, stored address, ref, page count —
 * which `citations_resolve` resolves `#cite-<ref>-<page>` against (amendment
 * 2026-09-28b). Offline: the manual is a real PDF on a local blob server, no
 * model call. In a file of its own, so the seeded resource never reaches
 * `harness.test.ts`'s database.
 */

let files: LocalBlobServer;

beforeAll(async () => {
  files = await startLocalBlobServer(mkdtempSync(join(tmpdir(), "makerlab-eval-attached-")));
});

afterAll(async () => {
  await files.close();
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  for (const key of getNotionEnvContract()) vi.stubEnv(key, "");
  // The eval's own file server on 127.0.0.1 — a real request, as in `npm run eval`.
  msw.use(http.get(`${files.origin}/*`, () => passthrough()));
});

function trotecCase(): EvalCase {
  return {
    id: "attached",
    prompt: "How do I focus the lens?",
    context: { page: "tool", toolId: "trotec-speedy-400" },
    assert: [{ kind: "citations_resolve" }],
    file: "t.yaml",
  };
}

describe("composeCase — attached manuals", () => {
  it("attaches the unsearchable PDF, tells the model its ref, and captures the route's link metadata", async () => {
    const resourceId = await seedEvalAttachedManual(files);
    const composed = await composeCase(trotecCase());

    expect(composed.attachedManuals).toEqual([
      {
        title: EVAL_ATTACHED_TITLE,
        url: files.url("manuals/trotec-speedy-400-operator-guide.pdf"),
        ref: resourceId.replace(/-/g, "").slice(0, 8).toLowerCase(),
        pageCount: 10,
      },
    ]);
    const { ref } = composed.attachedManuals[0];
    expect(composed.system).toContain("## Available manuals");
    expect(composed.system).toContain(`**${EVAL_ATTACHED_TITLE}** — ref \`${ref}\`, 10 pages`);
    expect(composed.system).toContain(`#cite-${ref}-12`);

    // The bytes go to the model as a PDF file part on the first user message.
    const [first] = attachManualsToFirstUserMessage(caseMessages(trotecCase()), composed.manuals);
    expect(first.role).toBe("user");
    const parts = first.content as Array<{ type: string; mediaType?: string; filename?: string }>;
    expect(parts[0]).toMatchObject({ type: "file", mediaType: "application/pdf", filename: `${EVAL_ATTACHED_TITLE}.pdf` });
  });

  it("attaches nothing to a machine whose manuals are all links or searchable", async () => {
    const composed = await composeCase({ ...trotecCase(), context: { page: "tool", toolId: "form-4" } });
    expect(composed.attachedManuals).toEqual([]);
    expect(composed.manuals).toEqual([]);
    expect(composed.system).not.toContain("## Available manuals");
  });
});
