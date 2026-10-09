// @vitest-environment node
import { http, HttpResponse } from "msw";
import { server } from "../../../../test/msw/server";
import { useResendFake } from "../../../../test/msw/resend";
import { emailConfig, isEmailConfigured, previewAllowList, ticketHourlyCap } from "../config";
import { fromHeader, sendEmail, type OutgoingEmail } from "./email";

/**
 * The Resend client (email notifications spec §3.5, §10 unit): 200 → the
 * message id; 429, 409, 5xx and a dropped connection → retryable; 422/400 →
 * `invalid_recipient`; any other 4xx → `rejected`; and the provider's words,
 * which can echo the address, never come back out.
 */

const CONFIG = { apiKey: "re_test_key", from: "notify@notify.lab.example", replyTo: "makerlab@lab.example", baseUrl: "https://api.resend.com" };
const EMAIL: OutgoingEmail = {
  to: "niti@cornell.edu",
  subject: "New ticket: Laser not firing",
  text: "text part",
  html: "<p>html part</p>",
  headers: { "List-Unsubscribe": "<https://x/api/notifications/unsubscribe?t=a>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
  idempotencyKey: "0d6c1a8e-1111-2222-3333-444455556666",
};

describe("sendEmail", () => {
  it("POSTs one email with the key, the idempotency key, the headers and the reply-to", async () => {
    const fake = useResendFake(server);
    const result = await sendEmail(CONFIG, EMAIL);

    expect(result).toEqual({ ok: true, providerMessageId: "re_0001" });
    expect(fake.requests).toHaveLength(1);
    const [sent] = fake.requests;
    expect(sent.headers.authorization).toBe("Bearer re_test_key");
    expect(sent.headers["idempotency-key"]).toBe(EMAIL.idempotencyKey);
    expect(sent.body.to).toEqual(["niti@cornell.edu"]);
    expect(sent.body.from).toBe('"MakerLAB Tools" <notify@notify.lab.example>');
    expect(sent.body.reply_to).toBe("makerlab@lab.example");
    expect(sent.body.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
  });

  it.each([429, 409, 500, 503])("treats HTTP %i as retryable", async (status) => {
    const fake = useResendFake(server);
    fake.script(status);
    expect(await sendEmail(CONFIG, EMAIL)).toEqual({ ok: false, retryable: true, status });
  });

  it.each([
    [422, "invalid_recipient"],
    [400, "invalid_recipient"],
    [403, "rejected"],
    [401, "rejected"],
  ] as const)("treats HTTP %i as fatal: %s", async (status, code) => {
    const fake = useResendFake(server);
    fake.script(status);
    const result = await sendEmail(CONFIG, EMAIL);
    expect(result).toEqual({ ok: false, retryable: false, code, status });
    // The fake's error body names the address; nothing of it is in the result.
    expect(JSON.stringify(result)).not.toContain("niti@cornell.edu");
  });

  it("treats a dropped connection as retryable", async () => {
    server.use(http.post("https://api.resend.com/emails", () => HttpResponse.error()));
    expect(await sendEmail(CONFIG, EMAIL)).toEqual({ ok: false, retryable: true, status: null });
  });

  it("goes to RESEND_API_BASE_URL when it is set", async () => {
    const fake = useResendFake(server, "https://email-stub.test");
    await sendEmail({ ...CONFIG, baseUrl: "https://email-stub.test" }, EMAIL);
    expect(fake.requests).toHaveLength(1);
  });

  it("keeps a display name EMAIL_FROM already has, and strips quotes from the site's", () => {
    expect(fromHeader("Lab <a@b.c>")).toBe("Lab <a@b.c>");
    expect(fromHeader("a@b.c")).toBe('"MakerLAB Tools" <a@b.c>');
  });
});

describe("email config", () => {
  it("is null without a key or a sender, so nothing is sent", () => {
    expect(emailConfig({})).toBeNull();
    expect(emailConfig({ RESEND_API_KEY: "re_x" })).toBeNull();
    expect(emailConfig({ EMAIL_FROM: "a@b.c" })).toBeNull();
    expect(isEmailConfigured({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c" })).toBe(true);
    expect(emailConfig({ RESEND_API_KEY: "re_x", EMAIL_FROM: "a@b.c", RESEND_API_BASE_URL: "http://stub:4000/" })?.baseUrl).toBe("http://stub:4000");
  });

  it("allows everyone outside a preview, and only the list on a preview", () => {
    expect(previewAllowList({ VERCEL_ENV: "production" })).toBeNull();
    expect(previewAllowList({})).toBeNull();
    expect([...(previewAllowList({ VERCEL_ENV: "preview" }) ?? ["x"])]).toEqual([]);
    expect([...(previewAllowList({ VERCEL_ENV: "preview", EMAIL_PREVIEW_RECIPIENTS: " Isaac@Cornell.edu, ,luis@cornell.edu" }) ?? [])]).toEqual([
      "isaac@cornell.edu",
      "luis@cornell.edu",
    ]);
  });

  it("reads the hourly cap, falling back to 12", () => {
    expect(ticketHourlyCap({})).toBe(12);
    expect(ticketHourlyCap({ NOTIFY_TICKET_HOURLY_CAP: "3" })).toBe(3);
    expect(ticketHourlyCap({ NOTIFY_TICKET_HOURLY_CAP: "-1" })).toBe(12);
    expect(ticketHourlyCap({ NOTIFY_TICKET_HOURLY_CAP: "lots" })).toBe(12);
  });
});
