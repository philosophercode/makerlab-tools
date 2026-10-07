import { siteConfig } from "../../site-config.ts";
import type { EmailConfig } from "../config.ts";

/**
 * The Resend HTTP client: **the only module that talks to the mail provider**
 * (email notifications spec §3.5). One `POST /emails` per call, with `fetch`
 * and no SDK, the way `mirror/notion-client.ts` talks to Notion.
 * `RESEND_API_BASE_URL` points it at a stub in tests.
 *
 * Classifies every outcome into our own words (§3.3 step 5):
 *
 * - 200 → `sent` with the provider's message id.
 * - 429, 409 (a concurrent request with the same idempotency key), 5xx, a
 *   network error or a timeout → `retryable`: the step throws and the SDK
 *   retries with backoff. The idempotency key makes the retry safe.
 * - 422 or 400 → `invalid_recipient`; any other 4xx → `rejected`. Fatal: no
 *   retry.
 *
 * **The provider's response text never leaves this function.** It can echo
 * the recipient's address; only the status code and our own code do.
 */

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
  /** The delivery row's id. */
  idempotencyKey: string;
}

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; retryable: true; status: number | null }
  | { ok: false; retryable: false; code: "invalid_recipient" | "rejected"; status: number };

/** How long one request may take before it counts as a network failure. */
export const SEND_TIMEOUT_MS = 15_000;

/** `EMAIL_FROM` with the site's name as its display name, unless it already carries one. */
export function fromHeader(from: string): string {
  if (from.includes("<")) return from;
  const name = siteConfig.name.replace(/["\r\n<>]/g, "");
  return `"${name}" <${from}>`;
}

export async function sendEmail(config: EmailConfig, email: OutgoingEmail, fetchImpl: typeof fetch = fetch): Promise<SendResult> {
  const body: Record<string, unknown> = {
    from: fromHeader(config.from),
    to: [email.to],
    subject: email.subject,
    text: email.text,
    html: email.html,
    headers: email.headers,
  };
  if (config.replyTo) body.reply_to = config.replyTo;

  let response: Response;
  try {
    response = await fetchImpl(`${config.baseUrl}/emails`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": email.idempotencyKey,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch {
    return { ok: false, retryable: true, status: null };
  }

  if (response.ok) {
    let id: string | null = null;
    try {
      const parsed = (await response.json()) as { id?: unknown };
      id = typeof parsed.id === "string" && parsed.id.length <= 200 ? parsed.id : null;
    } catch {
      id = null;
    }
    return { ok: true, providerMessageId: id };
  }

  // Drain the body so the connection is freed; its bytes are dropped unread.
  await response.arrayBuffer().catch(() => undefined);
  const status = response.status;
  if (status === 429 || status === 409 || status >= 500) return { ok: false, retryable: true, status };
  if (status === 422 || status === 400) return { ok: false, retryable: false, code: "invalid_recipient", status };
  return { ok: false, retryable: false, code: "rejected", status };
}
