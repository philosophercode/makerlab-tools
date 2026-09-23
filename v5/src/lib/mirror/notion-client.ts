import {
  MIRROR_MAX_RATE_LIMIT_RETRIES,
  MIRROR_REQUESTS_PER_SECOND,
} from "./limits.ts";

/**
 * The mirror's Notion client (spec §3.8 "Push", §8 "External calls"): raw
 * `fetch` against the 2022-06-28 API, no SDK.
 *
 * What it guarantees, per client instance:
 *
 * - **Throttled.** Request *starts* are spaced at least `1000 / requestsPerSecond`
 *   ms apart (3/s by default — Notion's documented average). The slot is
 *   reserved synchronously, so concurrent callers queue rather than burst.
 * - **429 is waited out** for `Retry-After` seconds (1 when absent), up to
 *   `maxRateLimitRetries` times. A wait that would pass the deadline is not
 *   started: the call throws `rate_limited` at once, and what is left waits for
 *   the next push.
 * - **Bounded.** With a `deadline`, no request *starts* after it (`deadline`).
 *   A request already started is never cut short by the deadline: aborting a
 *   `POST /pages` Notion has already received would create the page and lose
 *   its id, and the next push would create it again. Every fetch instead gets
 *   the fixed {@link NOTION_REQUEST_TIMEOUT_MS} ceiling (`unavailable` when it
 *   fires), so a push step ends at most that long after its 45 s budget — far
 *   inside the 300 s function limit — and a setup call cannot hang a server
 *   action.
 * - **Never leaks the token.** Errors are built from the status, Notion's error
 *   code and Notion's message run through {@link scrubSecrets} with the token,
 *   cut to 300 characters. Headers and request bodies are never included, and
 *   nothing here logs.
 *
 * Relative imports with `.ts` extensions, no `server-only`: step code runs this
 * from an esbuild bundle under plain Node. MSW intercepts its `fetch` in tests.
 */

export const NOTION_API_VERSION = "2022-06-28";
export const NOTION_DEFAULT_BASE_URL = "https://api.notion.com/v1";

/** Every request is aborted after this long, deadline or not (a request never outlives it by the budget). */
export const NOTION_REQUEST_TIMEOUT_MS = 30_000;

/** How much of Notion's own message an error keeps. */
const MAX_MESSAGE_LENGTH = 300;

/**
 * The API base URL, read at call time. `NOTION_API_BASE_URL` is a test-only
 * override (the E2E stub server); production never sets it.
 */
export function notionApiBaseUrl(): string {
  const override = process.env.NOTION_API_BASE_URL?.trim();
  return (override || NOTION_DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export type NotionErrorCode =
  | "unauthorized"
  | "restricted"
  | "page_not_found"
  | "database_not_found"
  | "not_found"
  | "validation"
  | "conflict"
  | "rate_limited"
  | "unavailable"
  | "deadline";

/**
 * Every failure the client reports. `message` reads like
 * `Notion 404 object_not_found: Could not find database with ID: …` and never
 * holds the token.
 */
export class NotionMirrorError extends Error {
  code: NotionErrorCode;
  status: number | null;
  notionCode: string | null;

  constructor(code: NotionErrorCode, message: string, status: number | null = null, notionCode: string | null = null) {
    super(message);
    this.name = "NotionMirrorError";
    this.code = code;
    this.status = status;
    this.notionCode = notionCode;
  }
}

export interface NotionClientOptions {
  token: string;
  /** Epoch ms, compared against `now()`. No request starts after it. */
  deadline?: number;
  requestsPerSecond?: number;
  maxRateLimitRetries?: number;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** Overrides {@link notionApiBaseUrl}. */
  baseUrl?: string;
}

export interface NotionPageObject {
  object: "page";
  id: string;
  archived?: boolean;
  in_trash?: boolean;
  properties: Record<
    string,
    { id?: string; type: string; title?: { plain_text?: string }[] } & Record<string, unknown>
  >;
}

export interface NotionDatabaseObject {
  object: "database";
  id: string;
  archived?: boolean;
  in_trash?: boolean;
  title?: { plain_text?: string }[];
  properties: Record<
    string,
    { id?: string; name?: string; type: string; relation?: { database_id?: string } } & Record<string, unknown>
  >;
}

export interface NotionClient {
  /** `GET /pages/:id`; a 404 is `page_not_found`. */
  getPage(id: string): Promise<NotionPageObject>;
  /** `GET /databases/:id`; a 404 is `database_not_found`. */
  getDatabase(id: string): Promise<NotionDatabaseObject>;
  /** `POST /databases`; a 404 is `page_not_found` — the parent page. */
  createDatabase(body: unknown): Promise<NotionDatabaseObject>;
  /** `PATCH /databases/:id`; a 404 is `database_not_found`. */
  updateDatabase(id: string, body: unknown): Promise<NotionDatabaseObject>;
  /** `POST /pages`; a 404 is `database_not_found` — the parent database. */
  createPage(body: unknown): Promise<{ id: string }>;
  /** `PATCH /pages/:id`; a 404 is `page_not_found`. */
  updatePage(id: string, body: unknown): Promise<{ id: string }>;
  /** Milliseconds left before the deadline; `Infinity` with none. */
  remainingMs(): number;
}

type NotFoundCode = "page_not_found" | "database_not_found" | "not_found";

export function createNotionClient(options: NotionClientOptions): NotionClient {
  const { token, deadline } = options;
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? defaultSleep;
  const rps = options.requestsPerSecond ?? MIRROR_REQUESTS_PER_SECOND;
  const gapMs = rps > 0 ? 1000 / rps : 0;
  const maxRetries = Math.max(0, options.maxRateLimitRetries ?? MIRROR_MAX_RATE_LIMIT_RETRIES);
  const secrets = [token];

  /** The earliest moment the next request may start. */
  let nextStartAt = Number.NEGATIVE_INFINITY;

  function remainingMs(): number {
    return deadline === undefined ? Number.POSITIVE_INFINITY : deadline - now();
  }

  function deadlineError(): NotionMirrorError {
    return new NotionMirrorError("deadline", "Notion request not made: the time budget for this run is spent.");
  }

  /** Reserve the next start slot (synchronously), then wait for it. */
  async function throttle(): Promise<void> {
    const current = now();
    const startAt = Math.max(current, nextStartAt);
    if (deadline !== undefined && startAt >= deadline) throw deadlineError();
    nextStartAt = startAt + gapMs;
    const wait = startAt - current;
    if (wait > 0) await sleep(wait);
  }

  async function request<T>(method: string, path: string, body: unknown, notFound: NotFoundCode): Promise<T> {
    const url = `${(options.baseUrl ?? notionApiBaseUrl()).replace(/\/+$/, "")}${path}`;
    for (let attempt = 0; ; attempt += 1) {
      await throttle();
      const remaining = remainingMs();
      if (remaining <= 0) throw deadlineError();

      let response: Response;
      try {
        response = await fetch(url, {
          method,
          headers: {
            Authorization: `Bearer ${token}`,
            "Notion-Version": NOTION_API_VERSION,
            "Content-Type": "application/json",
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          // Deliberately not the remaining budget (see the header): a started
          // request runs to Notion's answer or this ceiling.
          signal: AbortSignal.timeout(NOTION_REQUEST_TIMEOUT_MS),
        });
      } catch (error) {
        const name = (error as { name?: string } | null)?.name;
        if (name === "TimeoutError" || name === "AbortError") {
          throw new NotionMirrorError(
            "unavailable",
            `Notion did not answer within ${NOTION_REQUEST_TIMEOUT_MS / 1000} seconds.`
          );
        }
        throw new NotionMirrorError("unavailable", "Notion could not be reached (network error).");
      }

      if (response.ok) {
        try {
          return (await response.json()) as T;
        } catch {
          throw new NotionMirrorError("unavailable", `Notion ${response.status}: the response was not JSON.`, response.status);
        }
      }

      if (response.status === 429) {
        const waitMs = retryAfterMs(response.headers.get("Retry-After"), now());
        await discard(response);
        if (attempt >= maxRetries) {
          throw new NotionMirrorError("rate_limited", "Notion 429 rate_limited: retries exhausted.", 429, "rate_limited");
        }
        if (deadline !== undefined && now() + waitMs >= deadline) {
          throw new NotionMirrorError(
            "rate_limited",
            "Notion 429 rate_limited: Retry-After runs past the time budget.",
            429,
            "rate_limited"
          );
        }
        // Every request on this client waits, not only this one: the limit is
        // the integration's, so the next request would be refused as well.
        nextStartAt = Math.max(nextStartAt, now() + waitMs);
        continue;
      }

      throw await errorFrom(response, notFound, secrets);
    }
  }

  return {
    getPage: (id) => request("GET", `/pages/${encodeURIComponent(id)}`, undefined, "page_not_found"),
    getDatabase: (id) => request("GET", `/databases/${encodeURIComponent(id)}`, undefined, "database_not_found"),
    createDatabase: (body) => request("POST", "/databases", body, "page_not_found"),
    updateDatabase: (id, body) => request("PATCH", `/databases/${encodeURIComponent(id)}`, body, "database_not_found"),
    createPage: (body) => request("POST", "/pages", body, "database_not_found"),
    updatePage: (id, body) => request("PATCH", `/pages/${encodeURIComponent(id)}`, body, "page_not_found"),
    remainingMs,
  };
}

/** The plain text of a page's title property — whichever property has type `title`. */
export function pageTitle(page: NotionPageObject): string | null {
  for (const property of Object.values(page.properties ?? {})) {
    if (property?.type !== "title") continue;
    const text = (property.title ?? []).map((part) => part.plain_text ?? "").join("").trim();
    return text || null;
  }
  return null;
}

const TOKEN_SHAPED = /(secret_|ntn_)[A-Za-z0-9]+/g;
const EMAIL_SHAPED = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/**
 * `text` with each of `secrets` and anything shaped like a Notion token
 * (`secret_…`, `ntn_…`) replaced by `[redacted]`. Email addresses are replaced
 * too: this is what stands between Notion's error text and a status line an
 * admin may paste into an issue, and the mirror carries reporter emails
 * (2026-09-23 amendment), which must never reach a log.
 */
export function scrubSecrets(text: string, secrets: string[] = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret) out = out.split(secret).join("[redacted]");
  }
  return out.replace(TOKEN_SHAPED, "[redacted]").replace(EMAIL_SHAPED, "[email]");
}

async function errorFrom(response: Response, notFound: NotFoundCode, secrets: string[]): Promise<NotionMirrorError> {
  const status = response.status;
  let notionCode: string | null = null;
  let message = "";
  try {
    const text = await response.text();
    try {
      const parsed = JSON.parse(text) as { code?: unknown; message?: unknown };
      if (typeof parsed.code === "string") notionCode = parsed.code;
      if (typeof parsed.message === "string") message = parsed.message;
    } catch {
      message = text;
    }
  } catch {
    // An unreadable body leaves the status to speak for itself.
  }
  const safeCode = notionCode ? scrubSecrets(notionCode, secrets).slice(0, 60) : null;
  const detail = scrubSecrets(message, secrets).replace(/\s+/g, " ").trim().slice(0, MAX_MESSAGE_LENGTH);
  const text = `Notion ${status}${safeCode ? ` ${safeCode}` : ""}${detail ? `: ${detail}` : ""}`;
  return new NotionMirrorError(codeForStatus(status, notFound), text, status, safeCode);
}

function codeForStatus(status: number, notFound: NotFoundCode): NotionErrorCode {
  if (status === 401) return "unauthorized";
  if (status === 403) return "restricted";
  if (status === 404) return notFound;
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "unavailable";
  return "validation";
}

/** `Retry-After` as milliseconds: seconds, or an HTTP date; 1 s when absent or unreadable. */
function retryAfterMs(header: string | null, nowMs: number): number {
  if (header !== null && header.trim() !== "") {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
    const date = Date.parse(header);
    if (Number.isFinite(date)) return Math.max(0, date - nowMs);
  }
  return 1000;
}

async function discard(response: Response): Promise<void> {
  try {
    // Read to the end so the connection can be reused. (Cancelling the stream
    // instead never settles under some fetch interceptors.)
    await response.arrayBuffer();
  } catch {
    // Nothing to do: the body is not used either way.
  }
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
