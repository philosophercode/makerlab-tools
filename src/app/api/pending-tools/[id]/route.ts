import { NextRequest } from "next/server";
import { z } from "zod";
import { resolveIdentity } from "../../../../lib/auth/identity";
import { can } from "../../../../lib/auth/permissions";
import {
  discardPendingTool,
  getPendingTool,
  updatePendingTool,
  type PendingToolPatch,
} from "../../../../lib/data/pending-tools";
import { DUPLICATE_RESOLUTION } from "../../../../lib/db/schema/vocabulary";
import { canActOnPendingTool } from "../../../../lib/intake/access";
import type {
  PendingApiError,
  PendingApiErrorCode,
  PendingToolResponse,
} from "../../../../lib/intake/types";
import { toPendingToolView } from "../../../../lib/intake/view";
import { checkRateLimit } from "../../../../lib/rate-limit";

/**
 * `PATCH /api/pending-tools/[id]` — edit, resolve or discard one pending item
 * (data platform design spec §4.10, §5.4 step 5, §8).
 *
 * **This is the only way a pending item's name, hints or duplicate decision
 * change.** §5.4 step 5 is explicit that edits go through here, never through
 * the model — `identify_tools` writes a row once, and everything after that is
 * a person typing into the intake table or the preliminary page, which is a
 * PATCH like any other form. The write itself — which statuses are editable,
 * how a rename re-runs the duplicate check, what discarding releases — lives
 * in `src/lib/data/pending-tools.ts`; this route is the gate in front of it:
 * who may call it, what shape a body must have, and which HTTP status each
 * refusal gets.
 *
 * **Two people, one gate.** `canActOnPendingTool` (`intake/access.ts`) is the
 * same function `identify_tools` and the intake table both check to decide
 * whether to show a control — hiding one is presentation, and this call is the
 * control. An item's own creator can always edit it; anyone else needs
 * `tools.approve` on top of `tools.add`, which is what lets a SuperMaker clean
 * up somebody else's batch on the review page.
 *
 * Every refusal is a {@link PendingApiError} JSON body: a `code` a client
 * renders through `intake.table.errors.<code>` or `admin.intake.errors.<code>`,
 * plus an English `error` that is a fallback for a caller with no messages
 * loaded (Article 6) — never the string a client actually shows.
 */

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 15;

/** Mirrors the cap `pending-tools.ts` applies server-side, so a value this
 * route would refuse never reaches it as a "sure, but nothing happened". */
const MAX_FIELD_LENGTH = 200;

/**
 * An optional text field: `""` (after trimming) clears it to `null`, anything
 * else is trimmed and capped. A caller cannot tell a value that was rejected
 * for length from one that was never sent — both are `invalid_body` — which is
 * fine, because the fix is the same either way: send something shorter.
 */
function optionalTextField() {
  return z
    .preprocess((value) => {
      if (typeof value !== "string") return value;
      const trimmed = value.trim();
      return trimmed === "" ? null : trimmed;
    }, z.string().max(MAX_FIELD_LENGTH).nullable())
    .optional();
}

/**
 * The body's strict shape (contracts §13): an unknown key, an empty object, or
 * a name that is blank or over length are all `invalid_body`, decided here
 * rather than handed to `updatePendingTool`, whose own `invalid_field` is for a
 * value that parses fine but does not make sense together with the row (an
 * `add_unit` resolution with no matched tool, for instance).
 */
const patchBodySchema = z
  .strictObject({
    name: z
      .preprocess(
        (value) => (typeof value === "string" ? value.trim() : value),
        z.string().min(1).max(MAX_FIELD_LENGTH)
      )
      .optional(),
    brand: optionalTextField(),
    categoryHint: optionalTextField(),
    locationHint: optionalTextField(),
    serialNumber: optionalTextField(),
    duplicateResolution: z.enum(DUPLICATE_RESOLUTION).nullable().optional(),
    discard: z.literal(true).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: "at least one field is required",
  });

/** What a validated body looks like — the same shape `intake/types.ts` calls `PatchPendingToolBody`. */
type ValidatedBody = z.infer<typeof patchBodySchema>;

function errorBody(code: PendingApiErrorCode, error: string): PendingApiError {
  return { code, error };
}

/** The patch `updatePendingTool` wants, built from every key but `discard`. */
function toPatch(body: ValidatedBody): PendingToolPatch {
  const patch: PendingToolPatch = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.brand !== undefined) patch.brand = body.brand;
  if (body.categoryHint !== undefined) patch.categoryHint = body.categoryHint;
  if (body.locationHint !== undefined) patch.locationHint = body.locationHint;
  if (body.serialNumber !== undefined) patch.serialNumber = body.serialNumber;
  if (body.duplicateResolution !== undefined) {
    patch.duplicateResolution = body.duplicateResolution;
  }
  return patch;
}

/** The HTTP status a data-layer refusal reason gets (contracts §13). */
function statusFor(reason: "not_found" | "not_editable" | "invalid_field"): number {
  if (reason === "not_editable") return 409;
  if (reason === "invalid_field") return 422;
  return 404;
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const identity = await resolveIdentity(req);

  // Rate-limited before the body is read or the row is touched (Article 4).
  const rate = await checkRateLimit("pendingTools", identity);
  if (!rate.allowed) {
    return Response.json(
      errorBody("rate_limited", "Too many requests. Please slow down."),
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } }
    );
  }

  // Told apart the way every other write route here tells them apart: 401
  // means signing in would work, 403 means it would not.
  if (identity.role === "anonymous") {
    return Response.json(
      errorBody("sign_in_required", "Sign in to edit pending equipment."),
      { status: 401 }
    );
  }
  if (!can(identity, "tools.add")) {
    return Response.json(
      errorBody("forbidden", "Your account cannot edit pending equipment."),
      { status: 403 }
    );
  }

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json(errorBody("invalid_body", "Invalid JSON."), { status: 400 });
  }
  const parsedBody = patchBodySchema.safeParse(raw);
  if (!parsedBody.success) {
    return Response.json(
      errorBody("invalid_body", "The request body did not match the expected shape."),
      { status: 400 }
    );
  }
  const body = parsedBody.data;

  const { id } = await params;
  // `getPendingTool` answers null for a missing row and for anything that is
  // not uuid-shaped alike — both are simply "no such item" to a caller.
  const item = await getPendingTool(id);
  if (!item) {
    return Response.json(errorBody("not_found", "No such item."), { status: 404 });
  }
  if (!canActOnPendingTool(identity, item)) {
    return Response.json(
      errorBody("forbidden", "Your account cannot edit this item."),
      { status: 403 }
    );
  }

  try {
    const result = body.discard === true
      ? await discardPendingTool(id)
      : await updatePendingTool(id, toPatch(body));

    if (!result.ok) {
      const reason = result.reason;
      const message =
        reason === "not_editable"
          ? "This item has moved on since this page opened — it may be researching, approved or discarded."
          : reason === "invalid_field"
            ? "That value does not make sense for this item."
            : "No such item.";
      return Response.json(errorBody(reason, message), { status: statusFor(reason) });
    }

    return Response.json({ item: toPendingToolView(result.item) } satisfies PendingToolResponse);
  } catch (err) {
    // No PII in the log line: an id and a stack, not a name or an email.
    console.error(`[pending-tools] PATCH ${id} failed`, err);
    return Response.json(
      errorBody("failed", "Something went wrong. Please try again."),
      { status: 500 }
    );
  }
}
