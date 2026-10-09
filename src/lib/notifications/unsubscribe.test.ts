// @vitest-environment node
import { signUnsubscribeToken, verifyUnsubscribeToken } from "./unsubscribe";

/**
 * The one-click unsubscribe token (email notifications spec §5.4, §10 unit):
 * round trip; a tampered payload, a wrong secret, a forged event and junk all
 * fail; and the token holds no address.
 */

const SECRET = "unsubscribe-test-secret-0123456789";
const claim = { userId: "demo-user-niti", event: "ticket.filed" as const, issuedAt: 1_791_000_000 };

describe("unsubscribe tokens", () => {
  it("round-trips the person, the event and the time", () => {
    const token = signUnsubscribeToken(claim, SECRET);
    expect(token).toMatch(/^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(verifyUnsubscribeToken(token, SECRET)).toEqual(claim);
  });

  it("signs nothing without a secret, and verifies nothing either", () => {
    expect(signUnsubscribeToken(claim, "")).toBeNull();
    const token = signUnsubscribeToken(claim, SECRET);
    expect(verifyUnsubscribeToken(token, "")).toBeNull();
  });

  it("refuses a token signed with another secret", () => {
    const token = signUnsubscribeToken(claim, SECRET);
    expect(verifyUnsubscribeToken(token, `${SECRET}-rotated`)).toBeNull();
  });

  it("refuses a payload changed after signing: another person or another event", () => {
    const token = signUnsubscribeToken(claim, SECRET)!;
    const [version, , signature] = token.split(".");
    for (const forged of [
      { u: "demo-user-isaac", e: "ticket.filed", t: claim.issuedAt },
      { u: claim.userId, e: "maintenance.due", t: claim.issuedAt },
    ]) {
      const payload = Buffer.from(JSON.stringify(forged)).toString("base64url");
      expect(verifyUnsubscribeToken(`${version}.${payload}.${signature}`, SECRET)).toBeNull();
    }
  });

  it("refuses an event that is not one, even when correctly signed", () => {
    const token = signUnsubscribeToken({ ...claim, event: "staff.digest" as never }, SECRET);
    expect(verifyUnsubscribeToken(token, SECRET)).toBeNull();
  });

  it("refuses junk, truncation and an oversized string", () => {
    const token = signUnsubscribeToken(claim, SECRET)!;
    for (const bad of [null, undefined, "", "v1", "v1..", token.slice(0, -3), `v2${token.slice(2)}`, "x".repeat(2000)]) {
      expect(verifyUnsubscribeToken(bad, SECRET)).toBeNull();
    }
  });

  it("carries no address, only the user id", () => {
    const token = signUnsubscribeToken(claim, SECRET)!;
    const payload = Buffer.from(token.split(".")[1], "base64url").toString("utf8");
    expect(payload).not.toMatch(/@/);
    expect(JSON.parse(payload)).toEqual({ u: claim.userId, e: claim.event, t: claim.issuedAt });
  });
});
