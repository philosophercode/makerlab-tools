import { z } from "zod";
import { illustrationsEnabled } from "../ai/models";
import { isBlobConfigured } from "../blob";
import { getCatalogTools } from "../catalog";
import { ILLUSTRATION_KIND, type IllustrationKind } from "../db/schema/vocabulary";
import { ILLUSTRATION_CAPTION, ILLUSTRATION_DAILY_PER_PERSON, ILLUSTRATION_DESCRIPTION_MAX_CHARS } from "../illustrations/limits";
import { makeIllustration, type IllustrationRefusal } from "../illustrations/make";
import { siteConfig } from "../site-config";
import type { Capability, CapabilityCtx, CapabilityTool } from "./types";

/**
 * The `illustrations` capability (gateway spec amendment 2026-10-07
 * "Generated illustrations in the chat"; assistant–GUI parity spec amendment
 * 2026-10-07 "Images in the chat").
 *
 * `make_illustration` draws one picture through the Gateway's image job
 * (`illustration`) for two uses only: an infographic of a plan the assistant
 * has just written, or a concept render of the student's own project idea.
 * The chat shows it with a fixed caption — "AI-generated illustration, not a
 * photo of our equipment. Check the manual and staff for exact steps." —
 * through the `data-illustration` part (`components/chat/ChatIllustration.tsx`).
 *
 * Why this is not the retired product-photo redraw: that one changed a real
 * machine's printed labels in the picture the catalogue would show. This one
 * never depicts the lab's equipment, never reaches the catalogue, a tool page
 * or a ticket (its own table, its own private blobs), and is labelled as an
 * illustration wherever it appears.
 *
 * - **Signed-in people only** (`chat.illustrate`): it spends money, so it is
 *   counted against a person. Anonymous visitors get the locked fragment,
 *   which tells the assistant to point them to sign-in.
 * - **Offered, not made unasked**: the prompt says to offer ("Want a sketch of
 *   this plan?") and call it only after a yes.
 * - **Caps**: once per reply (here and in the route's `prepareStep`),
 *   {@link ILLUSTRATION_DAILY_PER_PERSON} per person a day and a lab-wide
 *   daily budget (`illustrations/limits.ts`), counted in `chat_illustrations`.
 * - **The prompt is the server's**: the description is cleaned and fenced
 *   (`illustrations/prompt.ts`) — the lab's machines become generic, and
 *   requests to show controls, labels or safety signs are dropped.
 * - **Chat only**; not offered at all when `MODEL_ILLUSTRATION=off` or there
 *   is no Blob store ({@link illustrationsAvailable}, applied by the route).
 */

export const MAKE_ILLUSTRATION_TOOL = "make_illustration";
export const ILLUSTRATIONS_CAPABILITY_ID = "illustrations";

const input = z.object({
  kind: z
    .enum(ILLUSTRATION_KIND)
    .describe('"plan": an infographic of the plan or process you just wrote. "concept": a concept render of the student\'s own project idea.'),
  description: z
    .string()
    .min(1)
    .max(ILLUSTRATION_DESCRIPTION_MAX_CHARS)
    .describe(
      "For a plan, its steps in order, one per line, in plain words. For a concept, the object the student described: what it is, its shape, materials and colours. No machine brand names, no controls, screens or settings, no safety labels."
    ),
});
type Input = z.infer<typeof input>;

/** The chat part's payload (`data-illustration`). The caption is the chat's own, never sent. */
export interface IllustrationPayload {
  kind: "illustration";
  id: string;
  /** `/api/chat/illustrations/<id>`: served only to the person who asked. */
  url: string;
  width: number;
  height: number;
  subject: IllustrationKind;
}

type Result = { made: true; message: string } | { made: false; reason: IllustrationRefusal | "once_per_reply"; message: string };

/** Illustrations are offered only when switched on and there is somewhere to keep them. */
export function illustrationsAvailable(): boolean {
  return illustrationsEnabled() && isBlobConfigured();
}

/** Calls taken per turn, keyed on the turn's ctx (one object per request). */
const callsThisTurn = new WeakMap<CapabilityCtx, number>();

const REFUSALS: Record<IllustrationRefusal | "once_per_reply", string> = {
  off: "Illustrations are switched off. Say so in one line and carry on.",
  unavailable: "Illustrations are not available here (there is no file storage). Say so in one line and carry on.",
  sign_in: "Illustrations need a signed-in person. Say they can sign in with the Sign in button at the top of the page.",
  nothing_to_draw:
    "Nothing was left to draw once machine names, controls and labels were taken out. Offer to sketch the overall plan or idea in plain words instead.",
  person_limit: `This person has had today's ${ILLUSTRATION_DAILY_PER_PERSON} illustrations. Say they can ask again tomorrow.`,
  lab_budget: "The lab's illustration budget for today is spent. Say they can ask again tomorrow.",
  failed: "The illustration could not be made. Say so in one line and carry on without it. Do not try again in this reply.",
  once_per_reply: "One illustration per reply. Do not call make_illustration again in this reply.",
};

export const makeIllustrationTool: CapabilityTool<Input, Result> = {
  name: MAKE_ILLUSTRATION_TOOL,
  description:
    "Draw one AI illustration, shown in the chat with the label \"AI-generated illustration, not a photo of our equipment\": an infographic of a plan you just wrote (kind \"plan\") or a concept render of the student's own project idea (kind \"concept\"). Only after the student said yes to your offer. Never to show how a lab machine looks, its controls, labels or safety steps.",
  inputSchema: input,
  // It spends the lab's money and records a row, so it is not a read.
  kind: "write",
  chatOnly: true,
  async run({ kind, description }, ctx) {
    const taken = callsThisTurn.get(ctx) ?? 0;
    if (taken >= 1) return { made: false, reason: "once_per_reply", message: REFUSALS.once_per_reply };
    callsThisTurn.set(ctx, taken + 1);

    const result = await makeIllustration({
      userId: ctx.identity?.userId,
      kind,
      description,
      catalog: await getCatalogTools(),
    });
    if (!result.ok) return { made: false, reason: result.reason, message: REFUSALS[result.reason] };

    const payload: IllustrationPayload = {
      kind: "illustration",
      id: result.id,
      url: result.url,
      width: result.width,
      height: result.height,
      subject: result.kind,
    };
    ctx.writer?.write({ type: "data-illustration", id: `illustration-${result.id}`, data: payload });
    return {
      made: true,
      message: `The illustration is shown with the label "${ILLUSTRATION_CAPTION}" Say in one short line what it sketches. Never call it a photo or one of the lab's machines; the manual, the lab's notes and staff have the exact steps.`,
    };
  },
};

const SECTION = `## Illustrations

You can draw one illustration per reply with \`${MAKE_ILLUSTRATION_TOOL}\`, for two things only:
- **"plan"**: an infographic of a plan or process you have just written, such as the steps of a build that uses several machines;
- **"concept"**: a concept render of the student's own project idea.

**Offer it; do not make it unasked.** After you write a multi-step plan, or when a student describes a project idea, you may end with one short line such as "Want a sketch of this plan?". Call the tool only when they say yes in a later message, or ask for a sketch themselves.

Pass the steps or the idea in plain words, without machine brand names, control panels, buttons, screens, settings or safety labels. Never use it to show how one of the lab's machines looks, its controls, its labels or its safety steps: the tool card, the manual, the lab's notes and staff do that. The chat labels every illustration "${ILLUSTRATION_CAPTION}", so never call it a photo or one of the lab's machines, and do not describe it at length. Each person can have ${ILLUSTRATION_DAILY_PER_PERSON} a day.`;

function lockedSection(): string {
  return `## Illustrations

Signed-in members can ask for an AI sketch of a plan or a concept render of their project idea. This person is not signed in: if they ask for a sketch, picture or render, say that needs signing in with their ${siteConfig.institution} account (the Sign in button at the top of the page). Do not offer sketches otherwise.`;
}

export const illustrations: Capability = {
  id: ILLUSTRATIONS_CAPABILITY_ID,
  requiredPermission: "chat.illustrate",
  promptFragment: () => SECTION,
  lockedPromptFragment: lockedSection,
  tools: [makeIllustrationTool as CapabilityTool<unknown, unknown>],
};
