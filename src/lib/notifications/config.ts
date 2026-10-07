/**
 * Email configuration, read from the environment (email notifications spec §8
 * "Environment variables"). Read on every call, never cached at module load,
 * so a test can stub a variable and the step bundle sees the live value.
 *
 * Relative imports only and no `"server-only"`: workflow steps load this
 * module under plain Node.
 */

export const DEFAULT_RESEND_API_BASE_URL = "https://api.resend.com";

/** At most this many `ticket.filed` notifications fan out per rolling hour (§5.3). */
export const DEFAULT_TICKET_HOURLY_CAP = 12;

export interface EmailConfig {
  apiKey: string;
  /** The verified sender, e.g. `notify@notify.<lab domain>`. */
  from: string;
  replyTo: string | null;
  baseUrl: string;
}

type Env = Record<string, string | undefined>;

/**
 * The sending configuration, or null when the app cannot send: no
 * `RESEND_API_KEY`, or no `EMAIL_FROM` to send it from. Null is a normal
 * state (local, CI, a preview without the integration): every delivery is
 * then recorded as `not_configured` and nothing reaches the network.
 */
export function emailConfig(env: Env = process.env): EmailConfig | null {
  const apiKey = (env.RESEND_API_KEY ?? "").trim();
  const from = (env.EMAIL_FROM ?? "").trim();
  if (!apiKey || !from) return null;
  const replyTo = (env.EMAIL_REPLY_TO ?? "").trim() || null;
  const baseUrl = ((env.RESEND_API_BASE_URL ?? "").trim() || DEFAULT_RESEND_API_BASE_URL).replace(/\/+$/, "");
  return { apiKey, from, replyTo, baseUrl };
}

/** True when {@link emailConfig} would send. */
export function isEmailConfigured(env: Env = process.env): boolean {
  return emailConfig(env) !== null;
}

/**
 * Who a preview deployment may mail (§5.2). `null` means "not a preview":
 * anyone may be mailed. On `VERCEL_ENV=preview` it is the lower-cased list in
 * `EMAIL_PREVIEW_RECIPIENTS`, empty when unset, so a preview pointed at a copy
 * of production cannot mail the real staff list.
 */
export function previewAllowList(env: Env = process.env): ReadonlySet<string> | null {
  if ((env.VERCEL_ENV ?? "").trim() !== "preview") return null;
  const list = (env.EMAIL_PREVIEW_RECIPIENTS ?? "")
    .split(",")
    .map((address) => address.trim().toLowerCase())
    .filter(Boolean);
  return new Set(list);
}

/** `NOTIFY_TICKET_HOURLY_CAP`, or the default for anything that is not a positive whole number. */
export function ticketHourlyCap(env: Env = process.env): number {
  const raw = Number((env.NOTIFY_TICKET_HOURLY_CAP ?? "").trim());
  return Number.isInteger(raw) && raw > 0 ? raw : DEFAULT_TICKET_HOURLY_CAP;
}
