// @vitest-environment node
/**
 * MCP and demo passes (demo pass spec 2026-10-07 §8): no MCP tool reads the
 * sign-ups, so a visitor's name and email cannot leave through an assistant
 * connected over MCP — not even a super admin's — and a demo pass's ticket is
 * not the lab's maintenance history there either.
 *
 * Two layers: a static check that nothing under the capability registry or the
 * MCP handler names the table, and the real MCP route called as a super admin
 * with a sign-up and a demo ticket in the demo-seeded PGlite database.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { nextCacheMock } from "../../../../test/mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../../../../test/ai/models-stub")).stubModelsModule(await importOriginal())
);

import { eq } from "drizzle-orm";
import { POST } from "@/app/api/mcp/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { createApiToken } from "@/lib/data/api-tokens";
import { findOrCreateDemoSignup } from "@/lib/data/demo-signups";
import { createMaintenanceLog } from "@/lib/data/maintenance";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { units } from "@/lib/db/schema/index";
import { seedUser } from "../../../../test/utils/session";

const SRC = path.resolve(__dirname, "../../..");
const VISITOR = { name: "Zelda Visitorova", email: "zelda.visitorova@example.org", institution: "Hyrule Polytechnic" };
const DEMO_TICKET = "Demo pass: the laser is haunted";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

let nextId = 1;
async function callTool(name: string, args: Record<string, unknown>, headers: Record<string, string>): Promise<string> {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "198.51.100.77", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  return JSON.stringify(await res.json());
}

async function listTools(headers: Record<string, string>): Promise<string[]> {
  const res = await POST(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", "x-forwarded-for": "198.51.100.78", ...headers },
      body: JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: "tools/list" }),
    })
  );
  const json = await res.json();
  return (json.result.tools as Array<{ name: string }>).map((tool) => tool.name);
}

beforeEach(() => {
  // `vitest.setup.ts` clears env stubs after every test.
  vi.stubEnv("AUTH_SECRET", "mcp-demo-privacy-secret");
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterAll(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
  resetDbForTests();
});

describe("MCP never reaches the demo sign-ups", () => {
  it("has no capability or MCP module that names the table or its data module", () => {
    const files = [
      ...sourceFiles(path.join(SRC, "lib/capabilities")),
      ...sourceFiles(path.join(SRC, "lib/mcp")),
      ...sourceFiles(path.join(SRC, "app/api/mcp")),
    ];
    expect(files.length).toBeGreaterThan(20);
    const offenders = files.filter((file) => /demo_signups|demoSignups|demo-signups/.test(readFileSync(file, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("gives a super admin's MCP client no sign-up and no demo ticket, from any of the reads that touch people or tickets", async () => {
    const db = await getDb();
    await findOrCreateDemoSignup({ ...VISITOR, role: "other", runsMakerspace: false, useCase: null, consentToContact: true, passExpiresAt: new Date(Date.now() + 86_400_000) });
    const [trotec] = await db.select({ id: units.id }).from(units).where(eq(units.unitLabel, "Trotec Speedy 400"));
    await createMaintenanceLog({ title: DEMO_TICKET, description: "Spooky.", unitId: trotec.id, demo: true, reportedByName: VISITOR.name });

    const person = await seedUser({ email: `mcp-demo-privacy-${Date.now()}@cornell.edu`, role: "super_admin", name: "Dee Rector" });
    const created = await createApiToken({ userId: person.id, name: "test", readOnly: false });
    if (!created.ok) throw new Error("expected a token");
    const headers = { authorization: `Bearer ${created.token}` };

    const names = await listTools(headers);
    expect(names.length).toBeGreaterThan(10);
    expect(names.filter((name) => /demo|signup/i.test(name))).toEqual([]);

    const openTickets = await callTool("list_open_tickets", {}, headers);
    const history = await callTool("get_maintenance_history", { unit_label: "Trotec Speedy 400" }, headers);
    // The calls really ran: the queue and the unit's history came back.
    expect(openTickets).toContain("tickets");
    expect(history).toContain("maintenance_logs");
    const outputs = [
      openTickets,
      history,
      await callTool("get_unit_details", { unit_label: "Trotec Speedy 400" }, headers),
      await callTool("get_usage_summary", {}, headers),
      await callTool("list_tools", {}, headers),
    ].join("\n");
    expect(outputs.length).toBeGreaterThan(200);
    for (const value of [VISITOR.name, VISITOR.email, VISITOR.institution, DEMO_TICKET]) {
      expect(outputs).not.toContain(value);
    }
  });
});
