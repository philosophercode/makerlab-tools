import { http, HttpResponse } from "msw";
import type { SetupServer } from "msw/node";
import type { NotionFake } from "../fakes/notion-fake.ts";

/**
 * Install a {@link NotionFake} as MSW handlers (spec §10: "MSW for Notion").
 *
 * Every method on `${base}/*` goes to `fake.handle`, which answers exactly as
 * the E2E stub server does, so a push tested here and a push clicked through
 * in Playwright meet the same Notion. Registered with `server.use`, so the
 * shared `afterEach(resetHandlers)` in `vitest.setup.ts` removes it; call this
 * in a `beforeEach` (or in the test) rather than once per file.
 *
 * The request body is passed as text and parsed by the fake; the headers are
 * handed over for the token check and never logged.
 */
export function useNotionFake(server: Pick<SetupServer, "use">, fake: NotionFake, base = "https://api.notion.com/v1"): void {
  const prefix = new URL(base).pathname.replace(/\/+$/, "");
  const trimmedBase = base.replace(/\/+$/, "");
  server.use(
    http.all(`${trimmedBase}/*`, async ({ request }) => {
      const url = new URL(request.url);
      const path = url.pathname.startsWith(prefix) ? url.pathname.slice(prefix.length) : url.pathname;
      const text = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
      const response = fake.handle(request.method, path, request.headers, text);
      return HttpResponse.json(response.body as never, { status: response.status, headers: response.headers });
    })
  );
}
