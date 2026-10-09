// @vitest-environment node
/**
 * `/api/demo-pass` (demo pass spec 2026-10-07 §5.1, §5.2): signing up stores
 * the sign-up and sets the pass cookie; signing up again returns the same
 * pass; the honeypot, validation, the per-IP limit, the kill switch and a
 * missing secret each refuse as they should; the status read shows the money
 * and never the visitor.
 *
 * Real limiter, real identity, the demo-seeded PGlite database — no network.
 */
import { eq } from "drizzle-orm";
import { resetAuthForTests } from "@/lib/auth/config";
import { getDb, resetDbForTests } from "@/lib/db/client";
import { demoSignups } from "@/lib/db/schema/index";
import { signDemoPass } from "@/lib/demo-pass/token";
import { GET, POST } from "./route";

const SECRET = "demo-pass-route-test-secret";

let counter = 0;
function uniqueIp(): string {
  counter += 1;
  return `198.51.100.${counter}`;
}
let emails = 0;
function uniqueEmail(): string {
  emails += 1;
  return `visitor${emails}-${Date.now()}@example.org`;
}

function post(body: unknown, { ip = uniqueIp(), raw }: { ip?: string; raw?: string } = {}): Promise<Response> {
  return POST(
    new Request("https://makerlab.example/api/demo-pass", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip, "x-forwarded-proto": "https", host: "makerlab.example" },
      body: raw ?? JSON.stringify(body),
    })
  );
}

function status(cookie?: string): Promise<Response> {
  return GET(
    new Request("https://makerlab.example/api/demo-pass", {
      headers: { "x-forwarded-for": uniqueIp(), ...(cookie ? { cookie } : {}) },
    })
  );
}

const form = (overrides: Record<string, unknown> = {}) => ({
  name: "Ada Lovelace",
  email: uniqueEmail(),
  institution: "Analytical Engines Lab",
  role: "faculty",
  runsMakerspace: "yes",
  useCase: "Teaching",
  consent: true,
  website: "",
  ...overrides,
});

/** The `name=value` part of a `Set-Cookie` header. */
function cookieOf(res: Response): string {
  return (res.headers.get("set-cookie") ?? "").split(";")[0];
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", SECRET);
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetAuthForTests();
});

afterAll(() => resetDbForTests());

describe("POST /api/demo-pass", () => {
  it("stores the sign-up and sets a signed, httpOnly, secure cookie for 14 days", async () => {
    const body = form();
    const res = await post(body);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, status: "created", pass: { remainingUsd: 0.5, budgetUsd: 0.5, exhausted: false, contactEmail: "ies22@cornell.edu" } });
    // The visitor's own details are not echoed back.
    expect(JSON.stringify(json)).not.toContain(body.email);

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^makerlab\.demo_pass=v1\./);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("SameSite=Lax");
    const maxAge = Number(setCookie.match(/Max-Age=(\d+)/)?.[1]);
    expect(maxAge).toBeGreaterThan(14 * 86_400 - 60);
    expect(maxAge).toBeLessThanOrEqual(14 * 86_400);
    expect(res.headers.get("cache-control")).toBe("no-store");

    const db = await getDb();
    const [row] = await db.select().from(demoSignups).where(eq(demoSignups.email, body.email));
    expect(row).toMatchObject({ name: "Ada Lovelace", institution: "Analytical Engines Lab", role: "faculty", runsMakerspace: true, useCase: "Teaching", consentToContact: true, spentUsd: 0 });
  });

  it("returns the same pass, and its ledger, when the address signs up again", async () => {
    const email = uniqueEmail();
    const first = await post(form({ email }));
    const db = await getDb();
    const [row] = await db.select().from(demoSignups).where(eq(demoSignups.email, email));
    await db.update(demoSignups).set({ spentUsd: 0.2 }).where(eq(demoSignups.id, row.id));

    const again = await post(form({ email: email.toUpperCase(), name: "Not Ada" }));
    expect(again.status).toBe(200);
    expect(await again.json()).toMatchObject({ status: "existing", pass: { remainingUsd: 0.3 } });
    // Same row, unchanged details: one pass per address.
    expect(await db.select().from(demoSignups).where(eq(demoSignups.email, email))).toHaveLength(1);
    expect((await db.select().from(demoSignups).where(eq(demoSignups.id, row.id)))[0].name).toBe("Ada Lovelace");
    // And the new cookie names the same pass.
    const status1 = await (await status(cookieOf(first))).json();
    const status2 = await (await status(cookieOf(again))).json();
    expect(status1).toEqual(status2);
  });

  it("does not renew a pass that has ended", async () => {
    const email = uniqueEmail();
    await post(form({ email }));
    const db = await getDb();
    await db.update(demoSignups).set({ passExpiresAt: new Date(Date.now() - 1000) }).where(eq(demoSignups.email, email));
    const res = await post(form({ email }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "expired", pass: null });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("thanks a filled honeypot and stores nothing", async () => {
    const email = uniqueEmail();
    const res = await post(form({ email, website: "https://spam.example" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, status: "received", pass: null });
    expect(res.headers.get("set-cookie")).toBeNull();
    const db = await getDb();
    expect(await db.select().from(demoSignups).where(eq(demoSignups.email, email))).toHaveLength(0);
  });

  it("refuses missing, malformed and oversized fields, field by field", async () => {
    const res = await post({ name: "", email: "not-an-email", institution: "x".repeat(151) });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ ok: false, code: "invalid", fields: { name: "required", email: "invalidEmail", institution: "tooLong" } });
    expect((await post(null, { raw: "{not json" })).status).toBe(400);
    expect((await post(null, { raw: JSON.stringify({ ...form(), useCase: "x".repeat(9_000) }) })).status).toBe(413);
  });

  it("allows a conference's burst from one address — 60 an hour — then refuses", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 60; i += 1) {
      expect((await post(form(), { ip })).status).toBe(201);
    }
    const refused = await post(form(), { ip });
    expect(refused.status).toBe(429);
    expect(await refused.json()).toMatchObject({ ok: false, code: "rate_limited" });
    expect(refused.headers.get("retry-after")).toBe("3600");
  }, 30_000);

  it("is closed with DEMO_PASS=off, and unavailable without AUTH_SECRET", async () => {
    vi.stubEnv("DEMO_PASS", "off");
    const closed = await post(form());
    expect(closed.status).toBe(403);
    expect(await closed.json()).toEqual({ ok: false, code: "closed" });

    vi.stubEnv("DEMO_PASS", "");
    vi.stubEnv("AUTH_SECRET", "");
    resetAuthForTests();
    const unavailable = await post(form());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("GET /api/demo-pass", () => {
  it("shows a pass's money and end date, never the visitor", async () => {
    const body = form();
    const created = await post(body);
    const res = await status(cookieOf(created));
    const json = await res.json();
    expect(json).toMatchObject({ active: true, pass: { remainingUsd: 0.5, budgetUsd: 0.5, exhausted: false } });
    expect(JSON.stringify(json)).not.toMatch(new RegExp(`${body.email}|Ada|Analytical`));
  });

  it("knows no pass without a cookie, with a forged one, or once the pass has ended", async () => {
    expect(await (await status()).json()).toEqual({ active: false });
    const forged = await signDemoPass({ passId: "3f2504e0-4f89-41d3-9a0c-0305e82c3301", expiresAt: new Date(Date.now() + 86_400_000) }, "someone-elses-secret");
    expect(await (await status(`makerlab.demo_pass=${forged}`)).json()).toEqual({ active: false });

    const email = uniqueEmail();
    const created = await post(form({ email }));
    const db = await getDb();
    await db.update(demoSignups).set({ passExpiresAt: new Date(Date.now() - 1000) }).where(eq(demoSignups.email, email));
    expect(await (await status(cookieOf(created))).json()).toEqual({ active: false });
  });

  it("says spent once the ledger reaches the budget, and follows DEMO_PASS_BUDGET_USD", async () => {
    const email = uniqueEmail();
    const created = await post(form({ email }));
    const db = await getDb();
    await db.update(demoSignups).set({ spentUsd: 0.5 }).where(eq(demoSignups.email, email));
    expect(await (await status(cookieOf(created))).json()).toMatchObject({ active: true, pass: { remainingUsd: 0, exhausted: true } });
    vi.stubEnv("DEMO_PASS_BUDGET_USD", "1");
    expect(await (await status(cookieOf(created))).json()).toMatchObject({ active: true, pass: { remainingUsd: 0.5, exhausted: false } });
  });
});
