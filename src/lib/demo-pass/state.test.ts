import { identityFor } from "../../../test/utils/identities";
import { demoPassSetCookie, readDemoPassCookie } from "./cookie";
import { identityWithDemoPass } from "./identity";
import { demoPassState, toDemoPassView } from "./state";

/**
 * A pass's state against the budget, the identity a turn runs as, and the
 * cookie's attributes (demo pass spec 2026-10-07 §5.2, §5.3).
 */

const PASS = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const ENDS = new Date("2026-10-25T15:00:00.000Z");
const ledger = (spentUsd: number) => ({ id: PASS, passExpiresAt: ENDS, spentUsd, chargedTurns: 3 });

describe("demoPassState", () => {
  it("is the budget less the spend, never below zero", () => {
    expect(demoPassState(ledger(0.12), 0.5)).toMatchObject({ remainingUsd: 0.38, exhausted: false });
    expect(demoPassState(ledger(0.5), 0.5)).toMatchObject({ remainingUsd: 0, exhausted: true });
    expect(demoPassState(ledger(0.53), 0.5)).toMatchObject({ remainingUsd: 0, exhausted: true });
  });

  it("shows the browser money and an end date — no id", () => {
    const view = toDemoPassView(demoPassState(ledger(0.1), 0.5), null);
    expect(view).toEqual({ remainingUsd: 0.4, budgetUsd: 0.5, exhausted: false, expiresAt: ENDS.toISOString(), contactEmail: null });
    expect(JSON.stringify(view)).not.toContain(PASS);
  });
});

describe("identityWithDemoPass", () => {
  it("keys an unspent pass's turns on the pass, still anonymous", () => {
    const identity = identityWithDemoPass(identityFor("anonymous"), demoPassState(ledger(0.1), 0.5));
    expect(identity).toMatchObject({ role: "anonymous", rateLimitKey: `demo:${PASS}`, demoPass: { id: PASS, exhausted: false } });
  });

  it("keeps a spent pass on the IP key, marked", () => {
    const identity = identityWithDemoPass(identityFor("anonymous", { rateLimitKey: "ip:abc" }), demoPassState(ledger(0.6), 0.5));
    expect(identity).toMatchObject({ rateLimitKey: "ip:abc", demoPass: { id: PASS, exhausted: true } });
  });

  it("ignores a pass for somebody signed in, and changes nothing without one", () => {
    const student = identityFor("user");
    expect(identityWithDemoPass(student, demoPassState(ledger(0), 0.5))).toBe(student);
    const visitor = identityFor("anonymous");
    expect(identityWithDemoPass(visitor, null)).toBe(visitor);
  });
});

describe("the pass cookie", () => {
  it("is httpOnly, Lax, site-wide, secure on https and lives until the pass ends", () => {
    const now = new Date(ENDS.getTime() - 3600_000);
    const header = demoPassSetCookie("v1.value", ENDS, { secure: true, now });
    expect(header).toContain("makerlab.demo_pass=v1.value");
    expect(header).toContain("HttpOnly");
    expect(header).toContain("SameSite=Lax");
    expect(header).toContain("Path=/");
    expect(header).toContain("Secure");
    expect(header).toContain("Max-Age=3600");
    expect(demoPassSetCookie("v1.value", ENDS, { secure: false, now })).not.toContain("Secure");
  });

  it("is read from a Cookie header among others", () => {
    const headers = new Headers({ cookie: "theme=dark; makerlab.demo_pass=v1.abc.def; other=1" });
    expect(readDemoPassCookie(headers)).toBe("v1.abc.def");
    expect(readDemoPassCookie(new Headers({ cookie: "theme=dark" }))).toBeNull();
    expect(readDemoPassCookie(new Headers())).toBeNull();
  });
});
