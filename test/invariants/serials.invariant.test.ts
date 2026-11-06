// @vitest-environment node
import { nextCacheMock } from "../mocks/next-cache";

vi.mock("next/cache", () => nextCacheMock());
vi.mock("@/lib/ai/models", async (importOriginal) =>
  (await import("../ai/models-stub")).stubModelsModule(await importOriginal())
);

import { eq } from "drizzle-orm";
import { fc, IO_RUNS, RUNS } from "./fc";
import { POST as MCP } from "@/app/api/mcp/route";
import { GET as KIOSK } from "@/app/api/kiosk/route";
import { resetAuthForTests } from "@/lib/auth/config";
import { getCatalogTool, getCatalogTools } from "@/lib/catalog";
import { createApiToken } from "@/lib/data/api-tokens";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { units } from "@/lib/db/schema/index";
import { maskSerial, SERIAL_SHOWN } from "@/lib/serial-mask";
import { seedUser } from "../utils/session";

/**
 * INVARIANT 8 — a whole unit serial never reaches anyone who is not staff.
 *
 * Serials are staff-only (`catalog.view_serials`); everyone else sees
 * `•••• 1234`. For a random serial written into a real unit, every public
 * path — the catalogue reads the pages render from, the kiosk feed, and the
 * anonymous MCP endpoint's `list_tools`, `get_tool_details` and
 * `get_unit_details` — carries at most its last four characters, while a
 * staff MCP token does see it (so the property is not vacuous).
 *
 * And `maskSerial` itself, for any string: never more than four characters
 * of the original, and nothing at all for a serial of four or fewer.
 */

const AUTH_SECRET = "serials-invariant-secret";
let unitId: string;
let unitLabel: string;
let staffAuth: string;

beforeAll(async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  resetAuthForTests();
  const db = await getDb();
  const [unit] = await db.select().from(units).where(eq(units.serialNumber, "ML-F4-001"));
  unitId = unit.id;
  unitLabel = unit.unitLabel;
  const staff = await seedUser({ role: "admin" });
  const token = await createApiToken({ userId: staff.id, name: "invariant", readOnly: true });
  if (!token.ok) throw new Error("expected a token");
  staffAuth = `Bearer ${token.token}`;
}, 30_000);

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "");
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("DEMO_ADMIN", "");
});

afterAll(async () => {
  const db = await getDb();
  await db.update(units).set({ serialNumber: "ML-F4-001" }).where(eq(units.id, unitId));
  resetAuthForTests();
  resetDbForTests();
});

let rpcId = 0;
let staffChecks = 0;
let ip = 0;
async function mcp(name: string, args: Record<string, unknown>, authorization?: string): Promise<string> {
  ip = (ip + 1) % 250;
  const res = await MCP(
    new Request("http://localhost/api/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "x-forwarded-for": `198.18.0.${ip + 1}`,
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }),
    })
  );
  return res.text();
}

/** Serial-shaped and distinctive, so a hit is the serial and not a coincidence. */
const serial = fc
  .tuple(fc.constantFrom("SN", "QX", "ZZ9"), fc.stringMatching(/^[A-Z0-9-]{6,18}$/))
  .map(([prefix, body]) => `${prefix}${body}`);

describe("invariant: whole serials never reach non-staff", () => {
  it("public reads, the kiosk and anonymous MCP never carry the whole serial", async () => {
    await fc.assert(
      fc.asyncProperty(serial, async (sn) => {
        const db = await getDb();
        await db.update(units).set({ serialNumber: sn }).where(eq(units.id, unitId));
        const ending = sn.slice(-SERIAL_SHOWN);

        const catalog = JSON.stringify(await getCatalogTools());
        const tool = JSON.stringify(await getCatalogTool("form-4"));
        const kioskRes = await KIOSK(
          new Request("http://localhost/api/kiosk", { headers: { "x-forwarded-for": `198.19.0.${(ip++ % 250) + 1}` } })
        );
        expect(kioskRes.status).toBe(200);
        const kiosk = await kioskRes.text();
        const listed = await mcp("list_tools", {});
        const details = await mcp("get_tool_details", { id_or_name: "form-4" });
        const unit = await mcp("get_unit_details", { unit_label: unitLabel });

        for (const [where, text] of Object.entries({ catalog, tool, kiosk, listed, details, unit })) {
          expect(text.includes(sn), `${where} leaked the whole serial`).toBe(false);
        }
        // Not vacuous: the public reads answered, with the new masked ending.
        expect(tool).toContain(ending);
        expect(details).toContain(ending);

        // Staff do get it — the read path above is the real one. (The first
        // few cases only: the staff token has its own per-minute allowance.)
        if (staffChecks++ < 10) {
          expect(await mcp("get_tool_details", { id_or_name: "form-4" }, staffAuth)).toContain(sn);
        }
      }),
      { numRuns: IO_RUNS }
    );
  }, 120_000);

  it("maskSerial never shows more than the last four characters", () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 40, unit: "grapheme" }), (raw) => {
        const masked = maskSerial(raw);
        const chars = Array.from(raw.trim());
        if (chars.length <= SERIAL_SHOWN) {
          expect(masked).toBeUndefined();
          return;
        }
        expect(masked).toBe(`•••• ${chars.slice(-SERIAL_SHOWN).join("")}`);
        expect(masked!.includes(raw.trim())).toBe(false);
      }),
      { numRuns: RUNS }
    );
  });
});
