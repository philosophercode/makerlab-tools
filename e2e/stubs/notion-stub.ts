import { createServer, type IncomingMessage } from "node:http";

import { createNotionFake } from "../../test/fakes/notion-fake.ts";
import {
  NOTION_STUB_ORIGIN,
  NOTION_STUB_PAGE_ID,
  NOTION_STUB_PAGE_TITLE,
  NOTION_STUB_PORT,
  NOTION_STUB_TOKEN,
} from "./notion-fixture.ts";

/**
 * A stand-in for the Notion API, for the mirror E2E only (data platform spec
 * §10, E2E scenario 8).
 *
 * The mirror calls Notion from server actions and from workflow steps, which
 * no browser-side intercept can reach. So the Playwright server boots with
 * `NOTION_API_BASE_URL` pointing here, and every `/v1/*` request is answered by
 * `createNotionFake` — the same in-memory Notion the Vitest suites install
 * through MSW, so a push clicked through in a browser meets the Notion the
 * integration tests met. Seeded with one page, the one the admin shares with
 * the integration (§4.14).
 *
 * Run with `node --experimental-strip-types`: the fake is written to load
 * that way (no imports, no enums, no parameter properties). It logs one line
 * per request with the method, path and status — never a header, so never the
 * token, and never a body.
 */

const fake = createNotionFake({
  token: NOTION_STUB_TOKEN,
  pages: [{ id: NOTION_STUB_PAGE_ID, title: NOTION_STUB_PAGE_TITLE }],
});

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

/** Node's header record, flattened into the plain record the fake reads. */
function headersOf(req: IncomingMessage): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    out[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return out;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", NOTION_STUB_ORIGIN);

  // Playwright's readiness probe.
  if (url.pathname === "/") {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("notion stub");
    return;
  }

  if (!url.pathname.startsWith("/v1/")) {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
    return;
  }

  const method = req.method ?? "GET";
  const body = method === "GET" || method === "HEAD" ? "" : await readBody(req);
  const answer = fake.handle(method, url.pathname, headersOf(req), body);

  res.writeHead(answer.status, answer.headers);
  res.end(answer.body === undefined ? "" : JSON.stringify(answer.body));
  console.info(`[notion-stub] ${method} ${url.pathname} → ${answer.status}`);
});

server.listen(NOTION_STUB_PORT, () => {
  console.info(`[notion-stub] listening on ${NOTION_STUB_ORIGIN}`);
});
