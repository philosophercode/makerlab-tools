// @vitest-environment node
import { resetAuthForTests } from "@/lib/auth/config";
import { signInAsNew, type SignedInSession } from "../../../../test/utils/session";

/**
 * `POST /api/imports` (bulk intake spec §5 step 1, §8 "Authorization"):
 * importing needs `tools.add` — an admin or a super admin — and a student or an
 * anonymous visitor is refused before anything is read or written. The
 * document workflow's start is mocked; the service has its own tests.
 */

const wf = vi.hoisted(() => ({ start: vi.fn(async () => ({ runId: "run-imports-route" })) }));
vi.mock("workflow/api", () => ({ start: wf.start }));
vi.mock("../../../workflows/import-document", () => ({
  importDocument: Object.assign(async () => ({ items: 0, failedChunks: 0 }), { workflowId: "import-document" }),
}));

import { getBulkImport } from "@/lib/data/bulk-imports";
import { listPendingTools } from "@/lib/data/pending-tools";
import { resetDbForTests } from "@/lib/db/client";
import { POST } from "./route";

const AUTH_SECRET = "imports-route-test-secret";
let counter = 0;

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  wf.start.mockClear();
});

afterAll(() => {
  resetAuthForTests();
  resetDbForTests();
});

async function person(role: "user" | "admin" | "super_admin"): Promise<SignedInSession> {
  counter += 1;
  return signInAsNew({ email: `imports-${counter}-${crypto.randomUUID().slice(0, 6)}@cornell.edu`, role });
}

async function post(body: unknown, session: SignedInSession | null) {
  counter += 1;
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": `10.44.${counter % 250}.1` };
  if (session) headers.cookie = session.cookie;
  const res = await POST(new Request("http://localhost/api/imports", { method: "POST", headers, body: JSON.stringify(body) }) as never);
  return { status: res.status, body: await res.json() };
}

describe("POST /api/imports", () => {
  it("refuses an anonymous visitor and a student", async () => {
    expect((await post({ text: "Form 2" }, null)).status).toBe(401);
    const student = await post({ text: "Form 2" }, await person("user"));
    expect(student).toMatchObject({ status: 403, body: { code: "forbidden" } });
  });

  it("imports a pasted list for an admin: identified rows, and where to review them", async () => {
    const admin = await person("admin");
    const name = `Route drill ${crypto.randomUUID().slice(0, 6)}`;
    const res = await post({ text: `${name}\n2x ${name} bit set` }, admin);
    expect(res.status).toBe(201);
    expect(res.body.href).toBe(`/admin/intake/imports/${res.body.import.id}`);
    expect(res.body.import).toMatchObject({ status: "ready", format: "list", itemCount: 2, sourceKind: "paste" });
    const rows = await listPendingTools({ importId: res.body.import.id });
    expect(rows.every((row) => row.status === "identified" && row.createdBy === admin.user.id)).toBe(true);
  });

  it("leaves a table waiting for its columns and a document being read", async () => {
    const admin = await person("super_admin");
    const table = await post({ text: "Item\tQty\nBandsaw\t1", sourceName: null }, admin);
    expect(table.body.import.status).toBe("mapping");

    const prose =
      "Our inventory notes: the laser room has a Trotec Speedy 400 that was serviced in March, and the wood shop has a SawStop cabinet saw that students may use after training.";
    const doc = await post({ text: prose }, admin);
    expect(doc.body.import.status).toBe("parsing");
    expect(wf.start).toHaveBeenCalledTimes(1);
    expect((await getBulkImport(doc.body.import.id))?.workflowRunId).toBe("run-imports-route");
  });

  it("refuses a body with both or neither of text and attachmentId, and says why a list is refused", async () => {
    const admin = await person("admin");
    expect((await post({}, admin)).body.code).toBe("invalid_body");
    expect((await post({ text: "x", attachmentId: crypto.randomUUID() }, admin)).body.code).toBe("invalid_body");
    expect((await post({ text: "   " }, admin)).body).toMatchObject({ code: "empty" });
    expect((await post({ attachmentId: crypto.randomUUID() }, admin)).body).toMatchObject({ code: "file_not_found" });
  });

  it("refuses a document over the limit with its size in pages, and a list over 1,000 items with the count — nothing started", async () => {
    const admin = await person("admin");
    const sentence = "The lab keeps a laser cutter in the back room and services it every spring for the students. ";
    const prose = sentence.repeat(Math.ceil(280_000 / sentence.length)).slice(0, 280_000);
    const long = await post({ text: prose }, admin);
    expect(long.status).toBe(413);
    expect(long.body).toMatchObject({ code: "document_too_long", pages: 85, limitPages: 60, limitChars: 200_000 });
    expect(wf.start).not.toHaveBeenCalled();

    const rows = Array.from({ length: 1001 }, (_, i) => `Clamp ${i}\t1`).join("\n");
    const many = await post({ text: `Item\tQty\n${rows}` }, admin);
    expect(many.status).toBe(413);
    expect(many.body).toMatchObject({ code: "too_many_items", count: 1001, limit: 1000 });
  });
});
