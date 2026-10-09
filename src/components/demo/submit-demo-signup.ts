import type { DemoSignupField, DemoSignupFieldError } from "../../lib/demo-pass/signup";
import type { DemoPassView } from "../../lib/demo-pass/state";

/**
 * Posting the demo sign-up form and reading the answer (demo pass spec
 * 2026-10-07 §5.1) — what `POST /api/demo-pass` can say, as the form needs
 * it. Matching is on the response's `code` and `status`, never its words.
 */

export interface DemoSignupPayload {
  name: string;
  email: string;
  institution: string;
  role: string;
  runsMakerspace: "yes" | "no" | "";
  useCase: string;
  consent: boolean;
  /** The honeypot. A person leaves it empty. */
  website: string;
}

export type DemoSignupOutcome =
  | { kind: "done"; status: "created" | "existing" | "expired" | "received"; pass: DemoPassView | null }
  | { kind: "invalid"; fields: Partial<Record<DemoSignupField, DemoSignupFieldError>> }
  | { kind: "rateLimited" }
  | { kind: "closed" }
  | { kind: "unavailable" }
  | { kind: "failed" };

const STATUSES = new Set(["created", "existing", "expired", "received"]);

export async function submitDemoSignup(payload: DemoSignupPayload, fetcher: typeof fetch = fetch): Promise<DemoSignupOutcome> {
  let res: Response;
  try {
    res = await fetcher("/api/demo-pass", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    return { kind: "failed" };
  }
  const body = (await res.json().catch(() => null)) as {
    status?: string;
    code?: string;
    pass?: DemoPassView | null;
    fields?: Partial<Record<DemoSignupField, DemoSignupFieldError>>;
  } | null;

  if (res.ok && body && typeof body.status === "string" && STATUSES.has(body.status)) {
    return { kind: "done", status: body.status as "created" | "existing" | "expired" | "received", pass: body.pass ?? null };
  }
  if (res.status === 429) return { kind: "rateLimited" };
  if (body?.code === "invalid") return { kind: "invalid", fields: body.fields ?? {} };
  if (body?.code === "closed") return { kind: "closed" };
  if (res.status === 503) return { kind: "unavailable" };
  return { kind: "failed" };
}
