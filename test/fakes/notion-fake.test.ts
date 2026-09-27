// @vitest-environment node
import { NotionMirrorError, createNotionClient, pageTitle } from "../../src/lib/mirror/notion-client";
import { server } from "../msw/server";
// Aliased: the name starts with `use`, which eslint's rules-of-hooks reads as a React hook.
import { useNotionFake as installNotionFake } from "../msw/notion-mirror";
import { createNotionFake } from "./notion-fake";

/**
 * A self-test of the fake Notion, driven through the real mirror client over
 * MSW — so what the parts build against is known to speak the client's
 * dialect before anybody writes a push against it.
 */
const TOKEN = "ntn_FAKEtoken0123456789abcdef";
const PARENT = "0f5e4a3c-1111-2222-3333-44445555aaaa";

function setup() {
  const fake = createNotionFake({ token: TOKEN, pages: [{ id: PARENT, title: "MakerLab Tools — mirror" }] });
  installNotionFake(server, fake);
  const client = createNotionClient({ token: TOKEN, requestsPerSecond: 0 });
  return { fake, client };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as NotionMirrorError).code;
  }
  return "resolved";
}

describe("createNotionFake", () => {
  it("reads a seeded page's title, dashed or not", async () => {
    const { client } = setup();
    expect(pageTitle(await client.getPage(PARENT))).toBe("MakerLab Tools — mirror");
    expect((await client.getPage(PARENT.replace(/-/g, ""))).id).toBe(PARENT);
    expect(await codeOf(client.getPage(crypto.randomUUID()))).toBe("page_not_found");
  });

  it("refuses the wrong token with Notion's 401, and never logs a header", async () => {
    const { fake } = setup();
    const wrong = createNotionClient({ token: "ntn_wrong", requestsPerSecond: 0 });
    const error = await wrong.getPage(PARENT).catch((e: NotionMirrorError) => e);
    expect(error).toBeInstanceOf(NotionMirrorError);
    expect((error as NotionMirrorError).code).toBe("unauthorized");
    expect((error as NotionMirrorError).message).toBe("Notion 401 unauthorized: API token is invalid.");
    expect(JSON.stringify(fake.requests)).not.toContain("ntn_");
  });

  it("creates a database with its properties echoed, then merges a PATCH", async () => {
    const { fake, client } = setup();
    const categories = await client.createDatabase({
      parent: { type: "page_id", page_id: PARENT },
      title: [{ type: "text", text: { content: "Categories" } }],
      properties: { Name: { title: {} } },
    });
    const tools = await client.createDatabase({
      parent: { type: "page_id", page_id: PARENT },
      title: [{ type: "text", text: { content: "Tools" } }],
      description: [{ type: "text", text: { content: "Mirrored from MakerLab Tools. Edits here are overwritten." } }],
      properties: {
        Name: { title: {} },
        Published: { checkbox: {} },
        Category: { relation: { database_id: categories.id, single_property: {} } },
      },
    });
    expect(tools.properties.Published).toMatchObject({ name: "Published", type: "checkbox" });
    expect(tools.properties.Category.relation?.database_id).toBe(categories.id);
    expect(tools.properties.Name.id).toEqual(expect.any(String));

    const patched = await client.updateDatabase(tools.id, { properties: { Brand: { rich_text: {} }, Published: null } });
    expect(Object.keys(patched.properties).sort()).toEqual(["Brand", "Category", "Name"]);
    expect((await client.getDatabase(tools.id)).properties.Brand.type).toBe("rich_text");
    expect(fake.databases.size).toBe(2);
  });

  it("refuses a database under an unknown page, and one without a title property", async () => {
    const { client } = setup();
    expect(
      await codeOf(client.createDatabase({ parent: { page_id: crypto.randomUUID() }, properties: { Name: { title: {} } } }))
    ).toBe("page_not_found");
    expect(await codeOf(client.createDatabase({ parent: { page_id: PARENT }, properties: { Notes: { rich_text: {} } } }))).toBe(
      "validation"
    );
  });

  it("creates, updates and archives pages in a database, checking values against the schema", async () => {
    const { fake, client } = setup();
    const db = await client.createDatabase({
      parent: { page_id: PARENT },
      properties: { Name: { title: {} }, Published: { checkbox: {} } },
    });

    const created = await client.createPage({
      parent: { database_id: db.id },
      properties: { Name: { title: [{ text: { content: "Form 4" } }] } },
    });
    expect(fake.pagesIn(db.id)).toHaveLength(1);
    const stored = await client.getPage(created.id);
    expect(pageTitle(stored)).toBe("Form 4");
    expect(stored.properties.Published).toMatchObject({ type: "checkbox", checkbox: false });

    await client.updatePage(created.id, { properties: { Published: { checkbox: true } } });
    expect((await client.getPage(created.id)).properties.Published.checkbox).toBe(true);

    await client.updatePage(created.id, { archived: true });
    expect((await client.getPage(created.id)).archived).toBe(true);
    // Notion refuses to edit an archived page until it is unarchived.
    expect(await codeOf(client.updatePage(created.id, { properties: { Published: { checkbox: false } } }))).toBe("validation");
    await client.updatePage(created.id, { archived: false, properties: { Published: { checkbox: false } } });

    expect(await codeOf(client.createPage({ parent: { database_id: db.id }, properties: { Nope: { checkbox: true } } }))).toBe(
      "validation"
    );
    expect(await codeOf(client.createPage({ parent: { database_id: db.id }, properties: { Published: { rich_text: [] } } }))).toBe(
      "validation"
    );
    expect(await codeOf(client.createPage({ parent: { database_id: crypto.randomUUID() }, properties: {} }))).toBe(
      "database_not_found"
    );
    expect(await codeOf(client.updatePage(crypto.randomUUID(), { archived: true }))).toBe("page_not_found");
  });

  it("refuses a page into an archived or deleted database", async () => {
    const { fake, client } = setup();
    const db = await client.createDatabase({ parent: { page_id: PARENT }, properties: { Name: { title: {} } } });
    await client.updateDatabase(db.id, { archived: true });
    expect(await codeOf(client.createPage({ parent: { database_id: db.id }, properties: {} }))).toBe("database_not_found");

    fake.databases.delete(db.id);
    expect(await codeOf(client.getDatabase(db.id))).toBe("database_not_found");
  });

  it("injects failures for the next N matching requests, with Retry-After", async () => {
    const { fake } = setup();
    const sleeps: number[] = [];
    const client = createNotionClient({
      token: TOKEN,
      requestsPerSecond: 0,
      // A clock that stands still, so each wait is exactly Retry-After.
      now: () => 0,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });
    fake.failNext({ method: "GET", path: /^\/pages\// }, { status: 429, retryAfter: 2 }, 2);

    expect((await client.getPage(PARENT)).id).toBe(PARENT);
    expect(sleeps).toEqual([2000, 2000]);
    expect(fake.requests.filter((request) => request.method === "GET")).toHaveLength(3);

    fake.failNext({ path: /^\/databases$/ }, { status: 503 });
    expect(await codeOf(client.createDatabase({ parent: { page_id: PARENT }, properties: { Name: { title: {} } } }))).toBe(
      "unavailable"
    );
    expect(fake.requests.at(-1)).toMatchObject({ method: "POST", path: "/databases", body: expect.any(Object) });
  });

  it("resets to the seeded pages", async () => {
    const { fake, client } = setup();
    await client.createDatabase({ parent: { page_id: PARENT }, properties: { Name: { title: {} } } });
    const extra = fake.addPage({ title: "Another page" });
    fake.reset();
    expect(fake.databases.size).toBe(0);
    expect(fake.requests).toHaveLength(0);
    expect(fake.pages.has(PARENT)).toBe(true);
    expect(fake.pages.has(extra)).toBe(false);
  });

  it("serves a custom base URL, as the E2E stub is reached", async () => {
    const fake = createNotionFake({ token: TOKEN, pages: [{ id: PARENT, title: "Stub" }] });
    installNotionFake(server, fake, "http://127.0.0.1:3102/v1");
    const client = createNotionClient({ token: TOKEN, baseUrl: "http://127.0.0.1:3102/v1", requestsPerSecond: 0 });
    expect(pageTitle(await client.getPage(PARENT))).toBe("Stub");
    expect(fake.handle("GET", "/v1/pages/" + PARENT, { Authorization: `Bearer ${TOKEN}`, "Notion-Version": "2022-06-28" }, undefined).status).toBe(200);
    expect(fake.handle("GET", "/pages/" + PARENT, { Authorization: `Bearer ${TOKEN}` }, undefined).status).toBe(400);
  });
});
