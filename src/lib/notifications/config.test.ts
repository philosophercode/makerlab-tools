// @vitest-environment node
const email = vi.hoisted(() => ({ from: null as string | null, replyTo: null as string | null }));
vi.mock("../lab/config.ts", () => ({ lab: { email } }));

import { emailConfig } from "./config";

describe("emailConfig: the sender's precedence (lab config spec §12.1)", () => {
  beforeEach(() => {
    email.from = null;
    email.replyTo = null;
  });

  it("is off with no sender anywhere", () => {
    expect(emailConfig({ RESEND_API_KEY: "re_test" })).toBeNull();
  });

  it("takes the lab config's sender and reply-to when the environment sets none", () => {
    email.from = "Fab Lab <notify@example.edu>";
    email.replyTo = "lab@example.edu";
    expect(emailConfig({ RESEND_API_KEY: "re_test" })).toMatchObject({
      from: "Fab Lab <notify@example.edu>",
      replyTo: "lab@example.edu",
    });
  });

  it("lets EMAIL_FROM and EMAIL_REPLY_TO win over the file", () => {
    email.from = "Fab Lab <notify@example.edu>";
    email.replyTo = "lab@example.edu";
    expect(
      emailConfig({ RESEND_API_KEY: "re_test", EMAIL_FROM: "Ops <ops@example.org>", EMAIL_REPLY_TO: "ops@example.org" })
    ).toMatchObject({ from: "Ops <ops@example.org>", replyTo: "ops@example.org" });
  });

  it("needs the API key whatever the sender", () => {
    email.from = "Fab Lab <notify@example.edu>";
    expect(emailConfig({})).toBeNull();
  });
});
