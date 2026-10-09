import { http, HttpResponse } from "msw";
import type { SetupServer } from "msw/node";

/**
 * A stand-in for Resend's `POST /emails` (email notifications spec §10:
 * "Resend by MSW in Vitest"). It records every request (headers and JSON
 * body) and answers from a script of statuses, 200 when the script runs out.
 * Nothing is ever delivered.
 *
 * Like the provider, it treats a repeated `Idempotency-Key` as the same
 * email: the second request is answered with the first one's id and is not
 * counted again in {@link ResendFake.delivered}. That is what lets a test
 * assert "exactly one email per recipient" across retries and replays.
 *
 * Registered with `server.use`, so `vitest.setup.ts`'s `resetHandlers`
 * removes it after each test. MSW reaches workflow step code too, which
 * `vi.mock` does not.
 */

export const RESEND_BASE = "https://api.resend.com";

export interface RecordedEmail {
  headers: Record<string, string>;
  body: {
    from?: string;
    to?: string[];
    subject?: string;
    text?: string;
    html?: string;
    reply_to?: string;
    headers?: Record<string, string>;
  };
}

export interface ResendFake {
  /** Every request, in order, retries included. */
  requests: RecordedEmail[];
  /** One entry per distinct idempotency key that was answered 200: the emails a person would get. */
  delivered: () => RecordedEmail[];
  /** Answer the next requests with these statuses, in order, then 200. */
  script: (...statuses: number[]) => void;
}

export function useResendFake(server: Pick<SetupServer, "use">, base = RESEND_BASE): ResendFake {
  const requests: RecordedEmail[] = [];
  const firstOk = new Map<string, { id: string; email: RecordedEmail }>();
  const queue: number[] = [];
  let counter = 0;

  server.use(
    http.post(`${base.replace(/\/+$/, "")}/emails`, async ({ request }) => {
      const headers: Record<string, string> = {};
      request.headers.forEach((value, key) => {
        headers[key.toLowerCase()] = value;
      });
      const body = (await request.json().catch(() => ({}))) as RecordedEmail["body"];
      const email = { headers, body };
      requests.push(email);

      const status = queue.length > 0 ? (queue.shift() as number) : 200;
      if (status !== 200) {
        // Provider prose that echoes the address: the client must never keep it.
        return HttpResponse.json({ name: "error", message: `cannot send to ${body.to?.[0] ?? ""}` }, { status });
      }
      const key = headers["idempotency-key"] ?? `none-${requests.length}`;
      const existing = firstOk.get(key);
      if (existing) return HttpResponse.json({ id: existing.id });
      counter += 1;
      const id = `re_${counter.toString().padStart(4, "0")}`;
      firstOk.set(key, { id, email });
      return HttpResponse.json({ id });
    })
  );

  return {
    requests,
    delivered: () => [...firstOk.values()].map((entry) => entry.email),
    script: (...statuses: number[]) => {
      queue.push(...statuses);
    },
  };
}
