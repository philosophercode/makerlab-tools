// @vitest-environment node
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import { mirrorClientFor } from "./credentials";
import { encryptMirrorToken } from "./token-crypto";

const TOKEN = "ntn_TESTtoken0123456789abcdefABCDEF";
const SECRET = "test-auth-secret-for-mirror-credentials";
const PAGE_ID = "0f5e4a3c-1111-2222-3333-44445555aaaa";

describe("mirrorClientFor", () => {
  it("is not_connected with no stored token", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    expect(mirrorClientFor(null)).toEqual({ ok: false, code: "not_connected" });
    expect(mirrorClientFor(new Uint8Array())).toEqual({ ok: false, code: "not_connected" });
  });

  it("is key_unavailable without AUTH_SECRET", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    vi.stubEnv("AUTH_SECRET", "");
    expect(mirrorClientFor(stored)).toEqual({ ok: false, code: "key_unavailable" });
  });

  it("is token_unreadable after AUTH_SECRET rotates", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    vi.stubEnv("AUTH_SECRET", "a-rotated-auth-secret");
    expect(mirrorClientFor(stored)).toEqual({ ok: false, code: "token_unreadable" });
  });

  it("builds a client that sends the decrypted token and honours the options", async () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    let authorization: string | null = null;
    server.use(
      http.get("https://api.notion.com/v1/pages/:id", ({ request, params }) => {
        authorization = request.headers.get("authorization");
        return HttpResponse.json({ object: "page", id: params.id, properties: {} });
      })
    );

    const result = mirrorClientFor(encryptMirrorToken(TOKEN), { deadline: 42, now: () => 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.client.remainingMs()).toBe(42);
    await result.client.getPage(PAGE_ID);
    expect(authorization).toBe(`Bearer ${TOKEN}`);
    // The result carries a client, never the plaintext.
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });
});
