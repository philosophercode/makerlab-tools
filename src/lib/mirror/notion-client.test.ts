// @vitest-environment node
import { http, HttpResponse } from "msw";
import { server } from "../../../test/msw/server";
import {
  NOTION_API_VERSION,
  NOTION_DEFAULT_BASE_URL,
  NotionMirrorError,
  createNotionClient,
  notionApiBaseUrl,
  pageTitle,
  scrubSecrets,
  type NotionPageObject,
} from "./notion-client";

/**
 * The mirror's Notion client against MSW on `api.notion.com` (spec §3.8, §8,
 * §10 "429 with Retry-After"). Time is injected: `now` reads a counter and
 * `sleep` advances it, so throttling and backoff are asserted exactly and no
 * test waits on a real clock.
 */
const TOKEN = "ntn_TESTtoken0123456789abcdefABCDEF";
const BASE = NOTION_DEFAULT_BASE_URL;
const PAGE_ID = "0f5e4a3c-1111-2222-3333-44445555aaaa";

function fakeClock(start = 1_000_000) {
  let t = start;
  const sleeps: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      sleeps.push(ms);
      t += ms;
    },
    sleeps,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

function page(id = PAGE_ID): NotionPageObject {
  return {
    object: "page",
    id,
    properties: { title: { id: "title", type: "title", title: [{ plain_text: "MakerLab Tools " }, { plain_text: "— mirror" }] } },
  };
}

function notionError(status: number, code: string, message: string, headers: Record<string, string> = {}) {
  return HttpResponse.json({ object: "error", status, code, message }, { status, headers });
}

async function caught(promise: Promise<unknown>): Promise<NotionMirrorError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(NotionMirrorError);
    return error as NotionMirrorError;
  }
  throw new Error("expected a NotionMirrorError");
}

describe("createNotionClient", () => {
  it("sends the bearer token, the pinned Notion-Version and JSON", async () => {
    let seen: Headers | null = null;
    let body: unknown = null;
    server.use(
      http.patch(`${BASE}/pages/:id`, async ({ request, params }) => {
        seen = request.headers;
        body = await request.json();
        return HttpResponse.json({ object: "page", id: params.id });
      })
    );
    const clock = fakeClock();
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep });

    await expect(client.updatePage(PAGE_ID, { archived: true })).resolves.toEqual({ object: "page", id: PAGE_ID });
    expect(seen!.get("authorization")).toBe(`Bearer ${TOKEN}`);
    expect(seen!.get("notion-version")).toBe(NOTION_API_VERSION);
    expect(NOTION_API_VERSION).toBe("2022-06-28");
    expect(seen!.get("content-type")).toBe("application/json");
    expect(body).toEqual({ archived: true });
  });

  it("spaces request starts at least 1000 / requestsPerSecond ms apart", async () => {
    const clock = fakeClock();
    const starts: number[] = [];
    server.use(
      http.get(`${BASE}/pages/:id`, ({ params }) => {
        starts.push(clock.now());
        return HttpResponse.json(page(params.id as string));
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep, requestsPerSecond: 3 });

    for (let i = 0; i < 4; i += 1) await client.getPage(PAGE_ID);

    const gaps = starts.slice(1).map((start, i) => start - starts[i]);
    for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(1000 / 3 - 1e-6);
  });

  it("queues concurrent callers instead of bursting", async () => {
    // A clock that stands still while the callers queue, so each one's wait is
    // measured from the same instant.
    const sleeps: number[] = [];
    server.use(http.get(`${BASE}/pages/:id`, ({ params }) => HttpResponse.json(page(params.id as string))));
    const client = createNotionClient({
      token: TOKEN,
      now: () => 5_000,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      requestsPerSecond: 2,
    });

    await Promise.all([client.getPage(PAGE_ID), client.getPage(PAGE_ID), client.getPage(PAGE_ID)]);

    // Slots reserved at +0, +500 and +1000.
    expect(sleeps).toEqual([500, 1000]);
  });

  it("waits out a 429 for Retry-After seconds and then succeeds", async () => {
    const clock = fakeClock();
    let calls = 0;
    server.use(
      http.get(`${BASE}/databases/:id`, ({ params }) => {
        calls += 1;
        if (calls === 1) return notionError(429, "rate_limited", "Slow down.", { "Retry-After": "2" });
        return HttpResponse.json({ object: "database", id: params.id, properties: {} });
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep });

    await expect(client.getDatabase(PAGE_ID)).resolves.toMatchObject({ object: "database", id: PAGE_ID });
    expect(calls).toBe(2);
    expect(clock.sleeps).toEqual([2000]);
  });

  it("defaults a 429 without Retry-After to one second", async () => {
    const clock = fakeClock();
    let calls = 0;
    server.use(
      http.post(`${BASE}/pages`, () => {
        calls += 1;
        return calls === 1 ? notionError(429, "rate_limited", "Slow down.") : HttpResponse.json({ object: "page", id: PAGE_ID });
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep });

    await client.createPage({ parent: { database_id: PAGE_ID }, properties: {} });
    expect(clock.sleeps).toEqual([1000]);
  });

  it("gives up as rate_limited once the retries are spent", async () => {
    const clock = fakeClock();
    let calls = 0;
    server.use(
      http.get(`${BASE}/pages/:id`, () => {
        calls += 1;
        return notionError(429, "rate_limited", "Slow down.", { "Retry-After": "1" });
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep, maxRateLimitRetries: 2 });

    const error = await caught(client.getPage(PAGE_ID));
    expect(error.code).toBe("rate_limited");
    expect(error.status).toBe(429);
    expect(calls).toBe(3);
  });

  it("throws rate_limited without waiting when Retry-After runs past the deadline", async () => {
    const clock = fakeClock();
    server.use(
      http.get(`${BASE}/pages/:id`, () => notionError(429, "rate_limited", "Slow down.", { "Retry-After": "30" }))
    );
    const client = createNotionClient({
      token: TOKEN,
      now: clock.now,
      sleep: clock.sleep,
      deadline: clock.now() + 10_000,
    });

    const error = await caught(client.getPage(PAGE_ID));
    expect(error.code).toBe("rate_limited");
    expect(clock.sleeps).toEqual([]);
  });

  it("starts nothing after the deadline", async () => {
    const clock = fakeClock();
    let calls = 0;
    server.use(
      http.get(`${BASE}/pages/:id`, () => {
        calls += 1;
        return HttpResponse.json(page());
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep, deadline: clock.now() + 500 });

    expect(client.remainingMs()).toBe(500);
    await client.getPage(PAGE_ID);
    clock.advance(600);
    expect(client.remainingMs()).toBeLessThanOrEqual(0);

    const error = await caught(client.getPage(PAGE_ID));
    expect(error.code).toBe("deadline");
    expect(calls).toBe(1);
  });

  it("lets a request started just before the deadline finish, rather than abort a create Notion already has", async () => {
    // Real time for the fetch, fake time for the budget: 5 ms left when the
    // POST starts, and Notion takes 150 ms to answer. Cutting the request to
    // the leftover budget would abort it after Notion made the page, and the
    // next round would create it again.
    const clock = fakeClock();
    let created = 0;
    server.use(
      http.post(`${BASE}/pages`, async () => {
        created += 1;
        await new Promise((resolve) => setTimeout(resolve, 150));
        return HttpResponse.json(page());
      })
    );
    const client = createNotionClient({ token: TOKEN, now: clock.now, sleep: clock.sleep, deadline: clock.now() + 5 });

    await expect(client.createPage({ parent: { database_id: "d" }, properties: {} })).resolves.toMatchObject({ id: PAGE_ID });
    expect(created).toBe(1);
  });

  it("reports Infinity remaining with no deadline", () => {
    expect(createNotionClient({ token: TOKEN }).remainingMs()).toBe(Number.POSITIVE_INFINITY);
  });

  describe("maps Notion's statuses", () => {
    it("401 → unauthorized", async () => {
      server.use(http.get(`${BASE}/pages/:id`, () => notionError(401, "unauthorized", "API token is invalid.")));
      const error = await caught(createNotionClient({ token: TOKEN }).getPage(PAGE_ID));
      expect(error.code).toBe("unauthorized");
      expect(error.status).toBe(401);
      expect(error.notionCode).toBe("unauthorized");
      expect(error.message).toBe("Notion 401 unauthorized: API token is invalid.");
    });

    it("403 → restricted", async () => {
      server.use(http.get(`${BASE}/pages/:id`, () => notionError(403, "restricted_resource", "No access.")));
      expect((await caught(createNotionClient({ token: TOKEN }).getPage(PAGE_ID))).code).toBe("restricted");
    });

    it("getDatabase 404 → database_not_found", async () => {
      server.use(
        http.get(`${BASE}/databases/:id`, () =>
          notionError(404, "object_not_found", `Could not find database with ID: ${PAGE_ID}.`)
        )
      );
      const error = await caught(createNotionClient({ token: TOKEN }).getDatabase(PAGE_ID));
      expect(error.code).toBe("database_not_found");
      expect(error.message).toMatch(/^Notion 404 object_not_found: Could not find database/);
    });

    it("getPage 404 → page_not_found, createDatabase 404 → page_not_found (the parent)", async () => {
      server.use(
        http.get(`${BASE}/pages/:id`, () => notionError(404, "object_not_found", "Not found.")),
        http.post(`${BASE}/databases`, () => notionError(404, "object_not_found", "Not found."))
      );
      const client = createNotionClient({ token: TOKEN });
      expect((await caught(client.getPage(PAGE_ID))).code).toBe("page_not_found");
      expect((await caught(client.createDatabase({}))).code).toBe("page_not_found");
    });

    it("updatePage 404 → page_not_found, createPage 404 → database_not_found", async () => {
      server.use(
        http.patch(`${BASE}/pages/:id`, () => notionError(404, "object_not_found", "Not found.")),
        http.post(`${BASE}/pages`, () => notionError(404, "object_not_found", "Not found."))
      );
      const client = createNotionClient({ token: TOKEN });
      expect((await caught(client.updatePage(PAGE_ID, {}))).code).toBe("page_not_found");
      expect((await caught(client.createPage({}))).code).toBe("database_not_found");
    });

    it("updateDatabase 404 → database_not_found", async () => {
      server.use(http.patch(`${BASE}/databases/:id`, () => notionError(404, "object_not_found", "Not found.")));
      expect((await caught(createNotionClient({ token: TOKEN }).updateDatabase(PAGE_ID, {}))).code).toBe(
        "database_not_found"
      );
    });

    it("400 → validation, 409 → conflict", async () => {
      server.use(
        http.post(`${BASE}/pages`, () => notionError(400, "validation_error", "body.properties.Name should be defined.")),
        http.patch(`${BASE}/pages/:id`, () => notionError(409, "conflict_error", "Conflict occurred while saving."))
      );
      const client = createNotionClient({ token: TOKEN });
      expect((await caught(client.createPage({}))).code).toBe("validation");
      expect((await caught(client.updatePage(PAGE_ID, {}))).code).toBe("conflict");
    });

    it("500 → unavailable, and a non-JSON body is kept as text", async () => {
      server.use(http.get(`${BASE}/pages/:id`, () => new HttpResponse("upstream sad", { status: 502 })));
      const error = await caught(createNotionClient({ token: TOKEN }).getPage(PAGE_ID));
      expect(error.code).toBe("unavailable");
      expect(error.message).toBe("Notion 502: upstream sad");
    });

    it("a network failure → unavailable", async () => {
      server.use(http.get(`${BASE}/pages/:id`, () => HttpResponse.error()));
      expect((await caught(createNotionClient({ token: TOKEN }).getPage(PAGE_ID))).code).toBe("unavailable");
    });

    it("cuts Notion's message to 300 characters", async () => {
      server.use(http.post(`${BASE}/pages`, () => notionError(400, "validation_error", "x".repeat(1000))));
      const error = await caught(createNotionClient({ token: TOKEN }).createPage({}));
      expect(error.message).toBe(`Notion 400 validation_error: ${"x".repeat(300)}`);
    });
  });

  it("never puts the token in an error message or on the console", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => {})
    );
    server.use(
      http.get(`${BASE}/pages/:id`, () =>
        notionError(401, "unauthorized", `API token ${TOKEN} is invalid; also secret_ABC123def and reporter ada@cornell.edu`)
      ),
      http.post(`${BASE}/pages`, () => new HttpResponse(`echo: Bearer ${TOKEN}`, { status: 500 })),
      http.get(`${BASE}/databases/:id`, () => HttpResponse.error())
    );
    const client = createNotionClient({ token: TOKEN });

    const errors = [
      await caught(client.getPage(PAGE_ID)),
      await caught(client.createPage({ secret: TOKEN })),
      await caught(client.getDatabase(PAGE_ID)),
    ];
    for (const error of errors) {
      const text = `${error.message} ${error.stack ?? ""} ${JSON.stringify(error)}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain("secret_ABC123def");
      expect(text).not.toContain("ada@cornell.edu");
    }
    expect(errors[0].message).toContain("[redacted]");

    for (const spy of spies) {
      for (const call of spy.mock.calls) expect(call.map(String).join(" ")).not.toContain(TOKEN);
    }
  });
});

describe("notionApiBaseUrl", () => {
  it("defaults to api.notion.com", () => {
    expect(notionApiBaseUrl()).toBe("https://api.notion.com/v1");
  });

  it("reads NOTION_API_BASE_URL at call time", async () => {
    vi.stubEnv("NOTION_API_BASE_URL", "http://127.0.0.1:3102/v1/");
    expect(notionApiBaseUrl()).toBe("http://127.0.0.1:3102/v1");

    server.use(
      http.get("http://127.0.0.1:3102/v1/pages/:id", ({ params }) => HttpResponse.json(page(params.id as string)))
    );
    const client = createNotionClient({ token: TOKEN });
    await expect(client.getPage(PAGE_ID)).resolves.toMatchObject({ id: PAGE_ID });
  });
});

describe("pageTitle", () => {
  it("joins the plain text of the title property, whatever it is called", () => {
    expect(pageTitle(page())).toBe("MakerLab Tools — mirror");
    expect(
      pageTitle({
        object: "page",
        id: PAGE_ID,
        properties: {
          Status: { type: "select" },
          Name: { type: "title", title: [{ plain_text: "Form 4" }] },
        },
      })
    ).toBe("Form 4");
  });

  it("is null for an untitled page", () => {
    expect(pageTitle({ object: "page", id: PAGE_ID, properties: { title: { type: "title", title: [] } } })).toBeNull();
    expect(pageTitle({ object: "page", id: PAGE_ID, properties: {} })).toBeNull();
  });
});

describe("scrubSecrets", () => {
  it("removes the given secrets and anything token-shaped", () => {
    expect(scrubSecrets("a hunter2 b", ["hunter2"])).toBe("a [redacted] b");
    expect(scrubSecrets("key secret_abcDEF123 and ntn_xyz789")).toBe("key [redacted] and [redacted]");
    expect(scrubSecrets("nothing here", [""])).toBe("nothing here");
  });

  it("removes email addresses", () => {
    expect(scrubSecrets("reported by ada.l@cornell.edu today")).toBe("reported by [email] today");
  });
});
