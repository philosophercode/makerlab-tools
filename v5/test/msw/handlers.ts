import { http, HttpResponse } from "msw";
import {
  categoriesPage,
  locationsPage,
  maintenanceLogsPage,
  notionQueryResponse,
  pagesById,
  resourcesPage,
  toolsPage,
  unitsPage,
  type NotionPageFixture,
} from "../fixtures/notion";

const NOTION = "https://api.notion.com/v1";

// Map a database id to the fixture page(s) it should return. The Notion DB ids
// come from the NOTION_DB_* env vars; tests that exercise the real Notion path
// stub those envs to these sentinel values so the query handler can route by id.
//
// Agents that stub different db ids can override the query handler per-test
// with `server.use(...)`.
export const DB_IDS = {
  tools: "db-tools",
  categories: "db-categories",
  locations: "db-locations",
  units: "db-units",
  resources: "db-resources",
  maintenance_logs: "db-maintenance",
  flags: "db-flags",
} as const;

const PAGES_BY_DB: Record<string, NotionPageFixture[]> = {
  [DB_IDS.tools]: [toolsPage],
  [DB_IDS.categories]: [categoriesPage],
  [DB_IDS.locations]: [locationsPage],
  [DB_IDS.units]: [unitsPage],
  [DB_IDS.resources]: [resourcesPage],
  [DB_IDS.maintenance_logs]: [maintenanceLogsPage],
  [DB_IDS.flags]: [],
};

// ── Default handlers ────────────────────────────────────────────────
//
// All handlers are fixture-driven and overridable per-test via
// `server.use(...)`. The defaults assume the env's NOTION_DB_* vars are set to
// the DB_IDS sentinels above; if a request arrives for an unknown database id
// the handler returns an empty result set (so unknown-id paths don't 500).
export const handlers = [
  // POST /databases/:id/query — paginated query. Returns the fixtures mapped to
  // the database id. has_more is always false here (single page); override with
  // server.use(...) to test the next_cursor pagination loop.
  http.post(`${NOTION}/databases/:id/query`, ({ params }) => {
    const id = params.id as string;
    const pages = PAGES_BY_DB[id] ?? [];
    return HttpResponse.json(notionQueryResponse(pages));
  }),

  // POST /pages — create a page (e.g. createMaintenanceLog). Echoes back a page
  // envelope so pageToMaintenanceLog can parse it.
  http.post(`${NOTION}/pages`, async ({ request }) => {
    const body = (await request.json().catch(() => ({}))) as {
      properties?: Record<string, unknown>;
    };
    return HttpResponse.json({
      object: "page",
      id: "created-page-1",
      created_time: "2024-09-01T10:00:00.000Z",
      last_edited_time: "2024-09-01T10:00:00.000Z",
      properties: body.properties ?? {},
    });
  }),

  // GET /pages/:id — single page fetch. Returns the matching fixture or 404.
  http.get(`${NOTION}/pages/:id`, ({ params }) => {
    const id = params.id as string;
    const fixture = pagesById[id];
    if (!fixture) {
      return HttpResponse.json(
        { object: "error", status: 404, code: "object_not_found", message: "Not found" },
        { status: 404 }
      );
    }
    return HttpResponse.json(fixture);
  }),

  // POST /file_uploads — Notion file-upload session creation. Returns an id and
  // an upload_url the client then POSTs bytes to.
  http.post(`${NOTION}/file_uploads`, () => {
    return HttpResponse.json({
      id: "file-upload-1",
      object: "file_upload",
      status: "pending",
      upload_url: `${NOTION}/file_uploads/file-upload-1/send`,
    });
  }),

  // POST /file_uploads/:id/send — receive the bytes for an upload session.
  http.post(`${NOTION}/file_uploads/:id/send`, ({ params }) => {
    return HttpResponse.json({
      id: params.id as string,
      object: "file_upload",
      status: "uploaded",
    });
  }),

  // Upstash Redis REST pipeline (rate-limit.ts). The pipeline body is an array
  // of commands; the default returns INCR=1 (allowed) + EXPIRE ok. Wildcard host
  // so any UPSTASH_REDIS_REST_URL value matches. Override per-test to simulate
  // over-limit counts or non-ok responses (fail-open).
  http.post(/\/pipeline$/, () => {
    return HttpResponse.json([{ result: 1 }, { result: 1 }]);
  }),
];
