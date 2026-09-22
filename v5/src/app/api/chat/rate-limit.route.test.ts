// @vitest-environment node
/**
 * `/api/chat` at and over the tiered ceiling (auth design spec §8, §10).
 *
 * Unlike `route.test.ts`, this suite uses the **real** rate limiter and the
 * **real** `resolveIdentity`, so it exercises the thing that actually matters:
 * an anonymous visitor and a signed-in user hitting the same endpoint from the
 * same IP get different allowances, and the refusal offers a way forward.
 *
 * The model is still stubbed at the `streamText` boundary, and the catalogue
 * comes from the demo-seeded PGlite database — no network (Art. 3).
 */
import { resetAuthForTests } from "@/lib/auth/config";
import { resetDbForTests } from "@/lib/db/client";
import { signInAsNew } from "../../../../test/utils/session";

const AUTH_SECRET = "chat-ceiling-test-secret";

// ── Stub the model boundary ──────────────────────────────────────────
vi.mock("@ai-sdk/anthropic", () => {
  const anthropic = Object.assign(vi.fn(() => ({ modelId: "mock-model" })), {
    tools: {
      webFetch_20250910: vi.fn(() => ({ type: "web_fetch_mock" })),
      webSearch_20250305: vi.fn(() => ({ type: "web_search_mock" })),
    },
  });
  return { anthropic };
});

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    streamText: vi.fn(() => ({
      toUIMessageStream: () =>
        new ReadableStream({
          start(c) {
            c.close();
          },
        }),
    })),
  };
});

// Notion is not stubbed here: no request path in this suite reaches it. The
// catalogue reads Postgres, and the one Notion write left in the capability
// layer (`report_issue`, spec Phase 3) is never called from a ceiling test.

vi.mock("next/cache", () => ({
  cacheTag: vi.fn(),
  cacheLife: vi.fn(),
  revalidateTag: vi.fn(),
}));

import { POST } from "@/app/api/chat/route";

// The in-memory limiter is a per-process singleton keyed by
// `chat:<identity.rateLimitKey>`, so every test needs its own IP / user id.
let counter = 0;
function uniqueIp() {
  counter += 1;
  return `192.0.2.${counter}`;
}

/** A seeded `user` session — a real row and the cookie that addresses it. */
async function userCookie(): Promise<string> {
  const { cookie } = await signInAsNew({ role: "user", name: "Ada" });
  return cookie;
}

function chatRequest({ ip, cookie }: { ip: string; cookie?: string }): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": ip,
  };
  if (cookie) headers.cookie = cookie;
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers,
    body: JSON.stringify({
      messages: [{ id: "1", role: "user", parts: [{ type: "text", text: "hi" }] }],
    }),
  });
}

beforeEach(() => {
  vi.stubEnv("AUTH_SECRET", AUTH_SECRET);
  vi.stubEnv("DATABASE_URL", "");
  resetAuthForTests();
});

afterEach(() => {
  resetAuthForTests();
});

afterAll(() => {
  resetDbForTests();
});

describe("POST /api/chat — anonymous ceiling", () => {
  it("allows 8 messages an hour, then refuses the 9th", async () => {
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      statuses.push((await POST(chatRequest({ ip }))).status);
    }
    expect(statuses).toEqual([...Array(8).fill(200), 429]);
  });

  it("offers sign-in rather than a bare 429", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 8; i += 1) await POST(chatRequest({ ip }));

    const res = await POST(chatRequest({ ip }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("3600");

    const body = await res.json();
    // `code` is the contract the chat UI translates; the English text is only a
    // fallback for non-UI clients (Art. 6).
    expect(body.code).toBe("rate_limited_sign_in");
    expect(body.signInPath).toBe("/api/auth/sign-in/google");
    expect(body.limit).toBe(8);
    expect(body.error).toMatch(/sign in/i);
  });

  it("does not call the model once the ceiling is reached", async () => {
    const { streamText } = await import("ai");
    const ip = uniqueIp();
    for (let i = 0; i < 8; i += 1) await POST(chatRequest({ ip }));
    vi.mocked(streamText).mockClear();

    expect((await POST(chatRequest({ ip }))).status).toBe(429);
    expect(vi.mocked(streamText)).not.toHaveBeenCalled();
  });

  it("keeps one visitor's ceiling off another visitor's budget", async () => {
    const busy = uniqueIp();
    for (let i = 0; i < 8; i += 1) await POST(chatRequest({ ip: busy }));
    expect((await POST(chatRequest({ ip: busy }))).status).toBe(429);

    expect((await POST(chatRequest({ ip: uniqueIp() }))).status).toBe(200);
  });

  it("honors RATE_LIMIT_ANON_CHAT for a conference behind one NAT", async () => {
    vi.stubEnv("RATE_LIMIT_ANON_CHAT", "3");
    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 4; i += 1) {
      statuses.push((await POST(chatRequest({ ip }))).status);
    }
    expect(statuses).toEqual([200, 200, 200, 429]);
  });
});

describe("POST /api/chat — signed in", () => {
  it("gets the higher signed-in ceiling from the same IP that was exhausted", async () => {
    const ip = uniqueIp();
    for (let i = 0; i < 8; i += 1) await POST(chatRequest({ ip }));
    expect((await POST(chatRequest({ ip }))).status).toBe(429);

    const cookie = await userCookie();
    for (let i = 0; i < 20; i += 1) {
      expect((await POST(chatRequest({ ip, cookie }))).status).toBe(200);
    }
  });

  it("keys on the user, so changing IP neither resets nor escapes the ceiling", async () => {
    const cookie = await userCookie();
    const first = await POST(chatRequest({ ip: uniqueIp(), cookie }));
    expect(first.status).toBe(200);

    // 59 more from a different IP each time — still one budget, still allowed.
    for (let i = 0; i < 59; i += 1) {
      expect((await POST(chatRequest({ ip: uniqueIp(), cookie }))).status).toBe(200);
    }
    // 61st message overall: the signed-in ceiling, despite the IP churn.
    expect((await POST(chatRequest({ ip: uniqueIp(), cookie }))).status).toBe(429);
  });

  it("refuses without offering sign-in to someone already signed in", async () => {
    const cookie = await userCookie();
    for (let i = 0; i < 60; i += 1) await POST(chatRequest({ ip: uniqueIp(), cookie }));

    const res = await POST(chatRequest({ ip: uniqueIp(), cookie }));
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("rate_limited");
    expect(body.signInPath).toBeUndefined();
    expect(body.limit).toBe(60);
  });

  it("falls back to the anonymous ceiling when the cookie is tampered with", async () => {
    const cookie = await userCookie();
    const forged = cookie.replace(/.$/, (c) => (c === "A" ? "B" : "A"));

    const ip = uniqueIp();
    const statuses: number[] = [];
    for (let i = 0; i < 9; i += 1) {
      statuses.push((await POST(chatRequest({ ip, cookie: forged }))).status);
    }
    // Anonymous allowance, and never a 500 — a bad cookie is not an error.
    expect(statuses).toEqual([...Array(8).fill(200), 429]);
  });
});
