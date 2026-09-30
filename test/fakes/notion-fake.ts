/**
 * A stateful, in-memory Notion — the 2022-06-28 endpoints the mirror uses
 * (spec §10 "Mirror against mocked Notion", E2E scenario 8).
 *
 * One model, two transports: `test/msw/notion-mirror.ts` installs it as MSW
 * handlers for Vitest (including the workflow project, where MSW is the only
 * thing that reaches step code), and the E2E stub server calls `handle()` from
 * a plain `node:http` server reached through `NOTION_API_BASE_URL`. So this
 * file is pure: no imports, no enums, no parameter properties — Node's
 * `--experimental-strip-types` loads it as it is.
 *
 * What it models, and deliberately no more:
 *
 * - `GET /pages/:id` — a seeded workspace page (the page an admin shares with
 *   the integration), or a page created in a database.
 * - `POST /databases`, `GET /databases/:id`, `PATCH /databases/:id` (merges
 *   properties; `null` removes one).
 * - `POST /pages` into a database, `PATCH /pages/:id` (properties, archived).
 * - The bearer token (401 `unauthorized` otherwise) and the `Notion-Version`
 *   header (400 `missing_version`).
 * - 404 `object_not_found` for an unknown id; a page create into an unknown or
 *   archived database is refused the same way.
 * - Property values are checked against the database's schema: an unknown
 *   property name or a value of the wrong type is a 400 `validation_error`, so
 *   a push that drifts from the schema it created fails here as it would there.
 * - `failNext` injects a status (and `Retry-After`, and a code) for the next N
 *   matching requests.
 *
 * `requests` logs method, path, body and a timestamp — **never a header**, so
 * the token cannot reach a test's output through it.
 */

export interface NotionFakeResponse {
  status: number;
  headers: Record<string, string>;
  body: unknown;
}

export interface NotionFakeRequest {
  method: string;
  path: string;
  body: unknown;
  at: number;
}

export interface NotionFakeFailure {
  status: number;
  /** Seconds, sent as `Retry-After`. */
  retryAfter?: number;
  /** Notion's error code; derived from the status when omitted. */
  code?: string;
  message?: string;
}

export interface NotionFakeMatch {
  method?: string;
  path?: RegExp;
}

export interface FakeProperty {
  id: string;
  name: string;
  type: string;
  [key: string]: unknown;
}

export interface FakeDatabase {
  object: "database";
  id: string;
  parent: { type: "page_id"; page_id: string };
  title: RichText[];
  description: RichText[];
  properties: Record<string, FakeProperty>;
  archived: boolean;
  in_trash: boolean;
  created_time: string;
  last_edited_time: string;
}

export interface FakePage {
  object: "page";
  id: string;
  parent: { type: "workspace"; workspace: true } | { type: "database_id"; database_id: string };
  properties: Record<string, { id: string; type: string; [key: string]: unknown }>;
  archived: boolean;
  in_trash: boolean;
  created_time: string;
  last_edited_time: string;
}

interface RichText {
  type?: string;
  text?: { content?: string };
  plain_text?: string;
  [key: string]: unknown;
}

export interface NotionFake {
  handle(method: string, path: string, headers: Record<string, string> | Headers, body: unknown): NotionFakeResponse;
  databases: Map<string, FakeDatabase>;
  pages: Map<string, FakePage>;
  requests: NotionFakeRequest[];
  failNext(match: NotionFakeMatch, response: NotionFakeFailure, times?: number): void;
  /** Seed a workspace page (one an integration has been shared with). Returns its id. */
  addPage(page: { id?: string; title: string }): string;
  /** The pages created in one database, in creation order. */
  pagesIn(databaseId: string): FakePage[];
  /** Forget every database, created page, request and injected failure; re-seed the initial pages. */
  reset(): void;
}

export interface NotionFakeOptions {
  token: string;
  pages?: { id: string; title: string }[];
}

/** Property types whose value on a page is keyed by the type name. */
const PROPERTY_TYPES = new Set([
  "title",
  "rich_text",
  "number",
  "select",
  "multi_select",
  "status",
  "date",
  "people",
  "files",
  "checkbox",
  "url",
  "email",
  "phone_number",
  "relation",
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
]);

const JSON_HEADERS = { "Content-Type": "application/json" };

export function createNotionFake(options: NotionFakeOptions): NotionFake {
  const databases = new Map<string, FakeDatabase>();
  const pages = new Map<string, FakePage>();
  const requests: NotionFakeRequest[] = [];
  let failures: { match: NotionFakeMatch; response: NotionFakeFailure; remaining: number }[] = [];

  function addPage(page: { id?: string; title: string }): string {
    const id = normalizeId(page.id ?? "") ?? randomId();
    const at = new Date().toISOString();
    pages.set(id, {
      object: "page",
      id,
      parent: { type: "workspace", workspace: true },
      properties: { title: { id: "title", type: "title", title: [richText(page.title)] } },
      archived: false,
      in_trash: false,
      created_time: at,
      last_edited_time: at,
    });
    return id;
  }

  function seed(): void {
    for (const page of options.pages ?? []) addPage(page);
  }

  function reset(): void {
    databases.clear();
    pages.clear();
    requests.length = 0;
    failures = [];
    seed();
  }

  function failNext(match: NotionFakeMatch, response: NotionFakeFailure, times = 1): void {
    failures.push({ match, response, remaining: times });
  }

  function takeFailure(method: string, path: string): NotionFakeFailure | null {
    for (const failure of failures) {
      if (failure.remaining <= 0) continue;
      if (failure.match.method && failure.match.method.toUpperCase() !== method) continue;
      if (failure.match.path && !failure.match.path.test(path)) continue;
      failure.remaining -= 1;
      return failure.response;
    }
    return null;
  }

  function pagesIn(databaseId: string): FakePage[] {
    const id = normalizeId(databaseId);
    return [...pages.values()].filter((page) => page.parent.type === "database_id" && page.parent.database_id === id);
  }

  function handle(
    rawMethod: string,
    rawPath: string,
    headers: Record<string, string> | Headers,
    rawBody: unknown
  ): NotionFakeResponse {
    const method = rawMethod.toUpperCase();
    const path = normalizePath(rawPath);
    const parsed = parseBody(rawBody);
    requests.push({ method, path, body: parsed.ok ? parsed.value : rawBody, at: Date.now() });

    const injected = takeFailure(method, path);
    if (injected) {
      const extra: Record<string, string> = {};
      if (injected.retryAfter !== undefined) extra["Retry-After"] = String(injected.retryAfter);
      return error(
        injected.status,
        injected.code ?? codeForStatus(injected.status),
        injected.message ?? `Injected ${injected.status}.`,
        extra
      );
    }

    if (header(headers, "authorization") !== `Bearer ${options.token}`) {
      return error(401, "unauthorized", "API token is invalid.");
    }
    if (!header(headers, "notion-version")) {
      return error(400, "missing_version", "Notion-Version header failed validation: Notion-Version header should be defined.");
    }
    if (!parsed.ok) return error(400, "invalid_json", "Error parsing JSON body.");
    const body = (parsed.value ?? {}) as Record<string, unknown>;

    const segments = path.split("/").filter(Boolean);
    const [resource, rawId, extra] = segments;
    if (extra !== undefined || !resource) return invalidUrl(method, path);
    const id = rawId === undefined ? null : normalizeId(rawId);
    if (rawId !== undefined && !id) return error(400, "validation_error", `path failed validation: path.id should be a valid uuid, instead was \`"${rawId}"\`.`);

    if (resource === "pages") {
      if (method === "GET" && id) return getPage(id);
      if (method === "POST" && !id) return createPage(body);
      if (method === "PATCH" && id) return updatePage(id, body);
    }
    if (resource === "databases") {
      if (method === "GET" && id) return getDatabase(id);
      if (method === "POST" && !id) return createDatabase(body);
      if (method === "PATCH" && id) return updateDatabase(id, body);
    }
    return invalidUrl(method, path);
  }

  // ── Pages ──────────────────────────────────────────────────────────

  function getPage(id: string): NotionFakeResponse {
    const page = pages.get(id);
    if (!page) return notFound("page", id);
    return ok(page);
  }

  function createPage(body: Record<string, unknown>): NotionFakeResponse {
    const parent = (body.parent ?? {}) as { database_id?: unknown; page_id?: unknown };
    if (typeof parent.database_id !== "string") {
      return error(400, "validation_error", "body failed validation: body.parent.database_id should be defined.");
    }
    const databaseId = normalizeId(parent.database_id);
    const database = databaseId ? databases.get(databaseId) : undefined;
    if (!database || database.archived || database.in_trash) return notFound("database", parent.database_id);

    const checked = checkValues(database, body.properties, true);
    if ("error" in checked) return checked.error;

    const at = new Date().toISOString();
    const page: FakePage = {
      object: "page",
      id: randomId(),
      parent: { type: "database_id", database_id: database.id },
      properties: checked.properties,
      archived: false,
      in_trash: false,
      created_time: at,
      last_edited_time: at,
    };
    pages.set(page.id, page);
    return ok(page);
  }

  function updatePage(id: string, body: Record<string, unknown>): NotionFakeResponse {
    const page = pages.get(id);
    if (!page) return notFound("page", id);

    const archiving = typeof body.archived === "boolean" ? body.archived : typeof body.in_trash === "boolean" ? body.in_trash : undefined;
    const staysArchived = archiving === undefined ? page.archived : archiving;
    if (body.properties !== undefined && staysArchived) {
      return error(400, "validation_error", "Can't edit block that is archived. You must unarchive the block before editing.");
    }

    if (body.properties !== undefined) {
      if (page.parent.type !== "database_id") {
        return error(400, "validation_error", "This fake only edits properties of pages in a database.");
      }
      const database = databases.get(page.parent.database_id);
      if (!database) return notFound("database", page.parent.database_id);
      const checked = checkValues(database, body.properties, false);
      if ("error" in checked) return checked.error;
      page.properties = { ...page.properties, ...checked.properties };
    }
    if (archiving !== undefined) {
      page.archived = archiving;
      page.in_trash = archiving;
    }
    page.last_edited_time = new Date().toISOString();
    return ok(page);
  }

  /**
   * Values against the database's schema, keyed by property name. `create`
   * also fills an empty value for every schema property the body omitted, as
   * Notion's page object does.
   */
  function checkValues(
    database: FakeDatabase,
    raw: unknown,
    create: boolean
  ): { properties: FakePage["properties"] } | { error: NotionFakeResponse } {
    if (raw !== undefined && (raw === null || typeof raw !== "object" || Array.isArray(raw))) {
      return { error: error(400, "validation_error", "body failed validation: body.properties should be an object.") };
    }
    const values = (raw ?? {}) as Record<string, unknown>;
    const out: FakePage["properties"] = {};
    for (const [name, value] of Object.entries(values)) {
      const property = database.properties[name];
      if (!property) {
        return { error: error(400, "validation_error", `${name} is not a property that exists.`) };
      }
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { error: error(400, "validation_error", `${name} is expected to be ${property.type}.`) };
      }
      const record = value as Record<string, unknown>;
      const declared = typeof record.type === "string" ? record.type : Object.keys(record).find((key) => PROPERTY_TYPES.has(key));
      if (declared !== property.type || !(property.type in record)) {
        return { error: error(400, "validation_error", `${name} is expected to be ${property.type}.`) };
      }
      out[name] = { id: property.id, type: property.type, [property.type]: normalizeValue(property.type, record[property.type]) };
    }
    if (create) {
      for (const property of Object.values(database.properties)) {
        if (!(property.name in out)) out[property.name] = { id: property.id, type: property.type, [property.type]: emptyValue(property.type) };
      }
    }
    return { properties: out };
  }

  // ── Databases ──────────────────────────────────────────────────────

  function getDatabase(id: string): NotionFakeResponse {
    const database = databases.get(id);
    if (!database) return notFound("database", id);
    return ok(database);
  }

  function createDatabase(body: Record<string, unknown>): NotionFakeResponse {
    const parent = (body.parent ?? {}) as { page_id?: unknown };
    if (typeof parent.page_id !== "string") {
      return error(400, "validation_error", "body failed validation: body.parent.page_id should be defined.");
    }
    const pageId = normalizeId(parent.page_id);
    const page = pageId ? pages.get(pageId) : undefined;
    if (!page || page.archived || page.in_trash) return notFound("page", parent.page_id);

    const built = buildProperties(body.properties, {});
    if ("error" in built) return built.error;
    const titles = Object.values(built.properties).filter((property) => property.type === "title");
    if (titles.length !== 1) {
      return error(400, "validation_error", "Title is not provided or there are multiple title properties.");
    }

    const at = new Date().toISOString();
    const database: FakeDatabase = {
      object: "database",
      id: randomId(),
      parent: { type: "page_id", page_id: page.id },
      title: normalizeRichTextArray(body.title),
      description: normalizeRichTextArray(body.description),
      properties: built.properties,
      archived: false,
      in_trash: false,
      created_time: at,
      last_edited_time: at,
    };
    databases.set(database.id, database);
    return ok(database);
  }

  function updateDatabase(id: string, body: Record<string, unknown>): NotionFakeResponse {
    const database = databases.get(id);
    if (!database) return notFound("database", id);
    if (body.properties !== undefined) {
      const built = buildProperties(body.properties, database.properties);
      if ("error" in built) return built.error;
      database.properties = built.properties;
    }
    if (body.title !== undefined) database.title = normalizeRichTextArray(body.title);
    if (body.description !== undefined) database.description = normalizeRichTextArray(body.description);
    if (typeof body.archived === "boolean") {
      database.archived = body.archived;
      database.in_trash = body.archived;
    }
    database.last_edited_time = new Date().toISOString();
    return ok(database);
  }

  /**
   * A property schema from a request's `properties`, merged over `existing`:
   * `{ Name: { title: {} } }` becomes `{ Name: { id, name: "Name", type: "title", title: {} } }`.
   * `null` removes a property; `{ name }` renames one.
   */
  function buildProperties(
    raw: unknown,
    existing: Record<string, FakeProperty>
  ): { properties: Record<string, FakeProperty> } | { error: NotionFakeResponse } {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return { error: error(400, "validation_error", "body failed validation: body.properties should be an object.") };
    }
    const out: Record<string, FakeProperty> = { ...existing };
    for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
      if (value === null) {
        delete out[name];
        continue;
      }
      if (typeof value !== "object" || Array.isArray(value)) {
        return { error: error(400, "validation_error", `body.properties.${name} should be an object.`) };
      }
      const spec = value as Record<string, unknown>;
      const current = out[name];
      const type = typeof spec.type === "string" ? spec.type : Object.keys(spec).find((key) => PROPERTY_TYPES.has(key)) ?? current?.type;
      if (!type || !PROPERTY_TYPES.has(type)) {
        return { error: error(400, "validation_error", `body.properties.${name} has no property type.`) };
      }
      const config = (spec[type] ?? current?.[type] ?? {}) as Record<string, unknown>;
      if (type === "relation") {
        const target = typeof config.database_id === "string" ? normalizeId(config.database_id) : null;
        if (!target || !databases.has(target)) {
          return { error: error(400, "validation_error", `body.properties.${name}.relation.database_id should be a database the integration can access.`) };
        }
        config.database_id = target;
      }
      const renamed = typeof spec.name === "string" && spec.name ? spec.name : name;
      if (renamed !== name) delete out[name];
      out[renamed] = { id: current?.id ?? propertyId(), name: renamed, type, [type]: config };
    }
    return { properties: out };
  }

  seed();

  return { handle, databases, pages, requests, failNext, addPage, pagesIn, reset };
}

// ── Helpers ──────────────────────────────────────────────────────────

function ok(body: unknown): NotionFakeResponse {
  return { status: 200, headers: { ...JSON_HEADERS }, body: clone(body) };
}

function error(status: number, code: string, message: string, extra: Record<string, string> = {}): NotionFakeResponse {
  return { status, headers: { ...JSON_HEADERS, ...extra }, body: { object: "error", status, code, message } };
}

function notFound(kind: "page" | "database", id: string): NotionFakeResponse {
  return error(
    404,
    "object_not_found",
    `Could not find ${kind} with ID: ${id}. Make sure the relevant pages and databases are shared with your integration.`
  );
}

function invalidUrl(method: string, path: string): NotionFakeResponse {
  return error(400, "invalid_request_url", `Invalid request URL: ${method} ${path}.`);
}

function codeForStatus(status: number): string {
  if (status === 401) return "unauthorized";
  if (status === 403) return "restricted_resource";
  if (status === 404) return "object_not_found";
  if (status === 409) return "conflict_error";
  if (status === 429) return "rate_limited";
  if (status === 502) return "bad_gateway";
  if (status === 503) return "service_unavailable";
  if (status >= 500) return "internal_server_error";
  return "validation_error";
}

function header(headers: Record<string, string> | Headers, name: string): string | null {
  if (typeof (headers as Headers).get === "function") return (headers as Headers).get(name);
  const record = headers as Record<string, string>;
  for (const [key, value] of Object.entries(record)) {
    if (key.toLowerCase() === name) return value;
  }
  return null;
}

function normalizePath(path: string): string {
  const bare = path.split("?")[0].replace(/\/+$/, "");
  const withSlash = bare.startsWith("/") ? bare : `/${bare}`;
  return withSlash.startsWith("/v1/") ? withSlash.slice(3) : withSlash;
}

function parseBody(body: unknown): { ok: true; value: unknown } | { ok: false } {
  if (body === undefined || body === null || body === "") return { ok: true, value: undefined };
  if (typeof body !== "string") return { ok: true, value: body };
  try {
    return { ok: true, value: JSON.parse(body) };
  } catch {
    return { ok: false };
  }
}

/** A Notion id — 32 hex, dashed or not — as a dashed lower-case uuid; null otherwise. */
function normalizeId(value: string): string | null {
  const hex = value.replace(/-/g, "").toLowerCase();
  if (!/^[0-9a-f]{32}$/.test(hex)) return null;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function randomId(): string {
  return crypto.randomUUID();
}

function propertyId(): string {
  return Math.random().toString(36).slice(2, 6);
}

function richText(content: string): RichText {
  return { type: "text", text: { content }, plain_text: content };
}

function normalizeRichTextArray(value: unknown): RichText[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const part = (item ?? {}) as RichText;
    return { type: "text", ...part, plain_text: part.plain_text ?? part.text?.content ?? "" };
  });
}

function normalizeValue(type: string, value: unknown): unknown {
  if (type === "title" || type === "rich_text") return normalizeRichTextArray(value);
  return clone(value);
}

function emptyValue(type: string): unknown {
  if (type === "title" || type === "rich_text" || type === "multi_select" || type === "people" || type === "files" || type === "relation") return [];
  if (type === "checkbox") return false;
  return null;
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}
