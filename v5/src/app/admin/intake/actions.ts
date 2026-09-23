"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorizeAdminAction } from "../../../lib/admin/action-gate";
import type { Identity } from "../../../lib/auth/identity";
import { can, type Permission } from "../../../lib/auth/permissions";
import { discardPendingTool, updatePendingTool } from "../../../lib/data/pending-tools";
import { isUuid } from "../../../lib/data/uuid";
import { addUnitAndRecord, approveAndRecord } from "../../../lib/intake/approve";
import {
  ADMIN_INTAKE_PATH,
  intakeItemPath,
  type IntakeActionError,
  type IntakeActionResult,
  type IntakeApproveResult,
} from "./action-result";

/**
 * The review queue's endpoints (spec §5.4 steps 10–12, §8, Article 5).
 *
 * This is where research becomes catalogue, and Article 5 says a person
 * decides it — so every action here resolves the caller, rate-limits and checks
 * its own permission through `authorizeAdminAction` before it reads anything.
 * A server action is a POST endpoint with a generated name: the page that
 * offers the button having checked `tools.approve` is evidence of nothing.
 *
 * - **Approve** publishes, so it needs `tools.publish` as well as
 *   `tools.approve`. The two are separate declarations so "SuperMakers may
 *   approve drafts but not publish them" stays a one-line change.
 * - **Approve as draft**, **Add unit**, **Discard** and the name/brand
 *   **Save** need `tools.approve`.
 *
 * **Every input is parsed here**, because a server action's arguments are
 * whatever the POST body said, not what the form's TypeScript promised. A
 * shape that does not parse is `invalid_field` and reaches nothing.
 *
 * **Refusals are values**, rendered from `admin.errors.<code>`; a thrown error
 * becomes `failed`, with its stack in the console, because a throw reaches the
 * browser as an error boundary rather than a sentence next to the button.
 *
 * Only async exports: the result types and the path live in
 * `./action-result.ts`.
 */

/** Names this surface in the console line a failed write leaves behind. */
const SURFACE = "admin/intake";

// ── Input shapes ────────────────────────────────────────────────────

/** Text a person typed into one line: trimmed, capped like the data layer caps it. */
const MAX_LINE = 200;

/** A description is Markdown and may be long; a runaway paste may not. */
const MAX_DESCRIPTION = 20_000;

/** The "I've checked this" note (§5.4 step 12). */
const MAX_OVERRIDE_NOTE = 1000;

const id = z.string().refine(isUuid);

/** Trimmed, capped, and "" becomes null — an empty box means "not set". */
function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullable()
    .transform((value) => (value ? value : null));
}

const list = z.array(z.string().trim().min(1).max(MAX_LINE)).max(50);

const approvalFields = z.strictObject({
  name: z.string().trim().min(1).max(MAX_LINE),
  description: optionalText(MAX_DESCRIPTION),
  categoryId: id.nullable(),
  newCategory: z
    .strictObject({
      name: z.string().trim().min(1).max(MAX_LINE),
      group: optionalText(MAX_LINE),
    })
    .nullable()
    .optional(),
  locationId: id.nullable(),
  materials: list,
  ppeRequired: list,
  tags: list,
  trainingRequired: z.boolean(),
  useRestrictions: optionalText(2000),
  serialNumber: optionalText(MAX_LINE),
  resourceUrls: z.array(z.string().max(2048)).max(50).optional(),
});

const approveInput = z.strictObject({
  id,
  fields: approvalFields,
  overrideNote: z.string().max(MAX_OVERRIDE_NOTE).nullable().optional(),
});

const addUnitInput = z.strictObject({
  id,
  serialNumber: optionalText(MAX_LINE),
});

const discardInput = z.strictObject({ id });

const identityInput = z.strictObject({
  id,
  name: z.string().trim().min(1).max(MAX_LINE),
  brand: optionalText(MAX_LINE),
});

// ── Actions ─────────────────────────────────────────────────────────

/** **Approve** — creates the tool, published (§5.4 step 11). */
export async function approvePending(input: unknown): Promise<IntakeApproveResult> {
  return approve(input, true);
}

/** **Approve as draft** — the same, unpublished, for finishing in the editor. */
export async function approvePendingAsDraft(input: unknown): Promise<IntakeApproveResult> {
  return approve(input, false);
}

/** **Add unit** — an add-unit item becomes another unit of the tool it matched. */
export async function addPendingUnit(input: unknown): Promise<IntakeApproveResult> {
  return run(
    "tools.approve",
    addUnitInput,
    input,
    async (identity, parsed): Promise<IntakeApproveResult> => {
      const userId = identity.userId;
      if (!userId) return { ok: false, error: "not_signed_in" };
      return addUnitAndRecord({ userId }, { id: parsed.id, serialNumber: parsed.serialNumber });
    }
  );
}

/**
 * **Discard** — the item leaves the queue and its photos are released for the
 * nightly sweep. Not audited: `AUDIT_ACTIONS` has no event for it (§4.11), and
 * nothing reached the catalogue.
 */
export async function discardPending(input: unknown): Promise<IntakeActionResult> {
  return run(
    "tools.approve",
    discardInput,
    input,
    async (_identity, parsed): Promise<IntakeActionResult> => {
      const discarded = await discardPendingTool(parsed.id);
      return discarded.ok ? { ok: true } : { ok: false, error: discarded.reason };
    }
  );
}

/**
 * The name/brand **Save** on the preliminary page. Goes through
 * `updatePendingTool`, which re-runs the duplicate check when either changes —
 * a corrected model name is exactly when a match appears or disappears.
 */
export async function savePendingIdentity(input: unknown): Promise<IntakeActionResult> {
  return run(
    "tools.approve",
    identityInput,
    input,
    async (_identity, parsed): Promise<IntakeActionResult> => {
      const updated = await updatePendingTool(parsed.id, {
        name: parsed.name,
        brand: parsed.brand,
      });
      return updated.ok ? { ok: true } : { ok: false, error: updated.reason };
    }
  );
}

// ── Internals ───────────────────────────────────────────────────────

/** Approve, published or not. Publishing is the extra permission. */
async function approve(input: unknown, publish: boolean): Promise<IntakeApproveResult> {
  return run(
    "tools.approve",
    approveInput,
    input,
    async (identity, parsed): Promise<IntakeApproveResult> => {
      // Checked here rather than as the gate's permission: the gate answers the
      // question every intake action shares, and this is the one thing that
      // makes Approve different from Approve as draft.
      if (publish && !can(identity, "tools.publish")) return { ok: false, error: "not_permitted" };

      const userId = identity.userId;
      if (!userId) return { ok: false, error: "not_signed_in" };

      return approveAndRecord(
        { userId },
        {
          id: parsed.id,
          publish,
          fields: parsed.fields,
          overrideNote: parsed.overrideNote ?? null,
        }
      );
    }
  );
}

/**
 * Gate, parse, write, refresh — each only as far as the last one earned.
 *
 * The gate runs **before** the parse, as it does on every route in the app: an
 * anonymous prodder learns nothing about the input shape for free. A refusal
 * from the write refreshes nothing, because nothing changed.
 *
 * Both paths are refreshed on success: the queue, whose row has moved on, and
 * the item's own page, which is where the person pressing the button is.
 */
async function run<P, T extends IntakeApproveResult | IntakeActionResult>(
  permission: Permission,
  schema: z.ZodType<P>,
  input: unknown,
  write: (identity: Identity, parsed: P & { id: string }) => Promise<T>
): Promise<T | { ok: false; error: IntakeActionError }> {
  const gate = await authorizeAdminAction(permission);
  if (!gate.ok) return gate;

  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid_field" };
  // Every schema here has an `id`; the intersection says so to the compiler.
  const data = parsed.data as P & { id: string };

  let result: T;
  try {
    result = await write(gate.identity, data);
  } catch (err) {
    console.error(`[${SURFACE}] the write failed`, err);
    return { ok: false, error: "failed" };
  }

  if (!result.ok) return result;

  revalidatePath(ADMIN_INTAKE_PATH);
  revalidatePath(intakeItemPath(data.id));
  return result;
}
