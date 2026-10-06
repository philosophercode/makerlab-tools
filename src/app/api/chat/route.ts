import {
  convertToModelMessages,
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  type FilePart,
  type ImagePart,
  type ModelMessage,
  type TextPart,
  type Tool,
  type UIMessage,
  type UserModelMessage,
} from "ai";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import {
  listResourcesForTool,
  type ToolResource,
} from "../../../lib/data/resources";
import { checkRateLimit, type RateLimitDecision } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";
import { siteConfig } from "../../../lib/site-config";
import { chatProviderOptions, languageModelFor } from "../../../lib/ai/models";
import { chatExaSearch, EXA_SEARCH_TOOL } from "../../../lib/ai/exa";
import { describeChatError } from "../../../lib/chat/describe-chat-error";
import { resourceHosts } from "../../../lib/capabilities/web";
import {
  appendManualSections,
  attachManualsToFirstUserMessage,
  attachedManualLinks,
  collectToolManuals,
} from "../../../lib/chat/attached-manuals";
import { loadToolManualsForChat } from "../../../lib/chat/tool-manuals";
import { curationForChat, recordSearchResults } from "../../../lib/chat/curation";
import { markOutsideReads, newTurnState } from "../../../lib/chat/taint";
import { curationCapability } from "../../../lib/capabilities/curation";
import { loadPageContext, pageContextSection } from "../../../lib/actions/page-context";
import { loadProposalOutcomes } from "../../../lib/chat/proposal-outcomes";
import { recordChatTurnUsage } from "../../../lib/usage/chat-turn";
import { chatPrepareStep } from "./prepare-step";
import { boundChatHistory, historyBudgetFor } from "../../../lib/chat/bound-history";
import { photoQrHints, photoQrSection } from "../../../lib/chat/photo-qr";
import {
  CAPABILITIES,
  capabilitiesForIdentity,
  composeChat,
} from "../../../lib/capabilities";
import type {
  CapabilityCtx,
  UploadedImage,
} from "../../../lib/capabilities";

/** Where the "sign in to keep chatting" affordance points. */
const SIGN_IN_PATH = "/api/auth/sign-in/google";

// Long step-by-step answers with manual lookups can run past a minute; at 60 s
// Vercel ended the stream mid-sentence. 300 s is the platform default.
export const maxDuration = 300;

interface ChatRequest {
  /** The conversation's id (`useChat`), recorded on the proposals a curation turn makes. */
  id?: string;
  messages: UIMessage[];
  toolId?: string;
  /** The pending item a preliminary page shows (refresh research spec §12.3). */
  pendingId?: string;
  locale?: string;
  /**
   * Where the person is (assistant–GUI parity spec §3.6): the path and the
   * rows they ticked. Re-read and permission-filtered on the server
   * (`lib/actions/page-context.ts`); never trusted as it arrives.
   */
  page?: unknown;
}

export async function POST(req: Request) {
  // Who is asking and what they sent, together: reading the body does not wait
  // on the session lookup (performance plan, quick win 8).
  const [identity, body] = await Promise.all([resolveIdentity(req), req.json() as Promise<ChatRequest>]);
  const { messages: rawMessages, toolId, locale, pendingId, id: rawChatId, page } = body;
  const chatId = typeof rawChatId === "string" && rawChatId.trim() ? rawChatId.slice(0, 200) : undefined;

  // How much they are allowed (auth design spec §8: anonymous visitors get a
  // small allowance keyed by hashed IP, signed-in callers a generous one keyed
  // by user id). Checked before any other read: a refused caller must not set
  // off database reads keyed by what it sent, and gets a 429, never a 500 from
  // a read it should not have reached. One fast query; the reads below that
  // depend only on the caller and the page then run together.
  const decision = await checkRateLimit("chat", identity);
  if (!decision.allowed) {
    return rateLimitedResponse(decision);
  }
  // The rate limit counts requests, so what one request may carry is bounded
  // too: history length, characters and photos (security fix 2026-10-05).
  const bounded = boundChatHistory(rawMessages, historyBudgetFor(identity.role));
  if (!bounded.ok) {
    return bounded.reason === "too_long"
      ? Response.json({ error: "That message is too long. Please shorten it.", code: "message_too_long" }, { status: 413 })
      : Response.json({ error: "Invalid request." }, { status: 400 });
  }
  const messages = bounded.messages;
  if (bounded.dropped > 0) console.info(`[chat] history bounded: ${bounded.dropped} older message(s) not sent to the model`);
  const [pageContext, outcomes, tools, focused, curation] = await Promise.all([
    // What the page shows and what is selected, and what became of this chat's
    // cards — both read from the database as this caller may see them.
    loadPageContext(identity, page),
    loadProposalOutcomes(chatId, identity),
    getCatalogTools(),
    toolId ? getCatalogTool(toolId) : Promise.resolve(null),
    // Curation (refresh research spec §12): the record the page shows, only for
    // a caller who may curate it — never composed for anyone else.
    curationForChat(identity, { toolId, pendingId }),
  ]);

  // Searchable manuals are answered through `search_manual` and listed in the
  // prompt with their contents; only the rest are attached whole (manual text
  // spec §3.6 — the fallback for `no_text`, `failed` or unprocessed manuals).
  // The two reads are independent; the PDFs themselves are fetched inside the
  // stream, so its response starts without waiting on a manual host.
  const [toolManuals, focusedResources] = focused
    ? await Promise.all([loadToolManualsForChat(focused.id, identity), loadResourcesForManuals(focused.id)])
    : [{ outlines: [], searchableResourceIds: new Set<string>() }, [] as ToolResource[]];
  if (focused) {
    const hosts = resourceHosts(focused);
    console.info(
      `[chat] focused tool: ${focused.name} (${focused.id}), links: ${focused.links.length}`
    );
    console.info(
      `[chat] read_page hosts: ${hosts.length ? hosts.join(", ") : "none"}`
    );
    console.info(`[chat] manuals searchable: ${toolManuals.outlines.length}`);
  }

  // Convert the UI messages, attach any server-fetched manuals, and surface the
  // uploaded photos for this turn both to the model (image bytes — design spec
  // §6.1) and to the capability layer (`attachments.id`s a write such as
  // `report_issue` claims onto the row it creates).
  const baseMessages = await convertToModelMessages(messages);
  const attachments = collectAttachments(baseMessages);
  if (attachments.length > 0) {
    console.info(`[chat] attachments for this turn: ${attachments.length}`);
  }
  // QR codes in this turn's photos (QR labels amendment), read while the
  // manuals are fetched: our tool links become a resolved hint for the model;
  // nothing a code says is passed on. Time-bounded and never rejects.
  const qrHintsPending = attachments.length > 0 ? photoQrHints(attachments) : Promise.resolve([] as string[]);

  const stream = createUIMessageStream({
    // Surface a useful, user-facing reason instead of the SDK's masked default
    // (e.g. tell a provider's bad minute from a real bug) — worded by kind, so
    // it names no provider and no configuration value.
    onError: reportChatError,
    execute: async ({ writer }) => {
      const { manuals, skipped } = await collectToolManuals(focusedResources, toolManuals.searchableResourceIds);
      if (focused) {
        console.info(`[chat] manuals attached: ${manuals.length}`);
        console.info(`[chat] manuals not attached (link only): ${skipped}`);
      }
      const modelMessages = attachManualsToFirstUserMessage(baseMessages, manuals);
      const qrHints = await qrHintsPending;
      if (qrHints.length > 0) console.info(`[chat] QR codes read from photos: ${qrHints.length}`);
      if (manuals.length > 0) {
        writer.write({
          type: "data-manuals-attached",
          data: { titles: manuals.map((m) => m.title) },
          transient: true,
        });
        // The attached manuals' stored addresses, kept on the message: the only
        // manual links the chat draws that no `search_manual` call returned —
        // as documents, never at a page the model picked (manual text spec
        // amendment 2026-09-28 "Citations always resolve").
        // Each carries the `ref` the model cites its pages by and the page
        // count, so the chat can link `#cite-<ref>-<page>` to the stored
        // address at that page, and only at a page the PDF has (amendment
        // 2026-09-28b "Attached manuals cite pages too").
        writer.write({
          type: "data-manual-links",
          data: {
            kind: "manual-links",
            links: attachedManualLinks(manuals),
          },
        });
      }

      // Build the capability context for this turn. The chat surface populates
      // every field; capabilities degrade gracefully when one is absent. The
      // identity resolved above rides along so tools record the verified caller
      // rather than a name typed into chat (auth design spec §3.4).
      const ctx: CapabilityCtx = {
        writer,
        attachments,
        locale,
        focusedToolId: focused?.id,
        identity,
        ...(curation ? { curation } : {}),
        ...(chatId ? { chatId } : {}),
        // Whether this turn read outside content (assistant–GUI parity spec §8.4):
        // attached manuals and a curation record are in the prompt from the start.
        turn: newTurnState({ outsideInPrompt: manuals.length > 0 || Boolean(curation) }),
      };

      // Compose the system prompt + capability tools from the shared registry
      // (`read_page` among them, confined to the focused tool's hosts), then add
      // web search: Exa, which the Gateway runs for any model, so it is not a
      // capability — the `web` capability's prompt tells the agent about it.
      //
      // The registry is composed as this caller may use it: a capability whose
      // required permission they do not hold contributes no tools, only a note
      // on why (spec §3.5).
      const capabilities = curation ? [...CAPABILITIES, curationCapability(curation.kind)] : CAPABILITIES;
      const { tools: capabilityTools, system } = composeChat(
        capabilitiesForIdentity(capabilities, identity),
        ctx,
        { tools, focusedTool: focused, locale, manualOutlines: toolManuals.outlines, ...(curation ? { curation } : {}) }
      );

      const chatTools: Record<string, Tool> = {
        ...capabilityTools,
        [EXA_SEARCH_TOOL]: chatExaSearch(),
      };

      const result = streamText({
        // Resolved here, inside the stream, so a misconfigured MODEL_CHAT
        // reaches the student as the error row naming the variable.
        model: languageModelFor("chat"),
        // Low reasoning effort and a stable prompt-cache key (performance plan,
        // quick win 2 and "Order the prompt so the provider cache can hit");
        // `MODEL_CHAT_REASONING` / `MODEL_CHAT_CACHE_KEY` override them.
        providerOptions: chatProviderOptions(),
        system: [appendManualSections(system, focused, manuals), pageContextSection(pageContext), outcomes, photoQrSection(qrHints)]
          .filter(Boolean)
          .join("\n\n"),
        messages: modelMessages,
        tools: chatTools,
        // Exa and read_page carry no per-turn cap of their own; we count.
        prepareStep: chatPrepareStep(Object.keys(chatTools)),
        // What the searches returned, for a curation turn's quote check and read_page hosts.
        // And whether it read outside content, for the tools the adapter does not wrap (Exa).
        onStepFinish: (step) => {
          recordSearchResults(ctx, step);
          markOutsideReads(ctx.turn, step);
        },
        stopWhen: stepCountIs(10),
        // Usage insight (usage insight spec §5.1): what this turn was about,
        // counted with no one in it and written after the response. Never
        // throws; a failed insert costs the student nothing.
        onFinish: ({ steps }) =>
          recordChatTurnUsage({ steps, messages, role: identity.role, focusedToolId: focused?.id, locale, turn: ctx.turn }),
      });

      writer.merge(result.toUIMessageStream({ onError: reportChatError }));
    },
  });

  return createUIMessageStreamResponse({ stream });
}

/**
 * The refusal at the allowance ceiling.
 *
 * An anonymous visitor gets a way forward, not a dead end: `code` is
 * `rate_limited_sign_in` and `signInPath` points at the sign-in route, so the
 * chat UI renders it as an assistant message offering sign-in rather than a bare
 * 429 (spec §5, §6). `code` is the contract — the English `error` is only a
 * fallback for non-UI clients, since translated copy lives in `messages/*.json`
 * (Article 6).
 */
function rateLimitedResponse(decision: RateLimitDecision): Response {
  const canSignIn = decision.role === "anonymous";
  return Response.json(
    {
      code: canSignIn ? "rate_limited_sign_in" : "rate_limited",
      ...(canSignIn ? { signInPath: SIGN_IN_PATH } : {}),
      limit: decision.limit,
      windowMs: decision.windowMs,
      retryAfterSeconds: decision.retryAfterSeconds,
      error: canSignIn
        ? `Too many requests. That is the hourly limit for visitors who are not signed in — sign in with your ${siteConfig.institution} account to keep chatting.`
        : "Too many requests. Please slow down.",
    },
    {
      status: 429,
      headers: { "Retry-After": String(decision.retryAfterSeconds) },
    }
  );
}

/**
 * The chat error row's text for a failed turn, logged once as it goes out.
 * The log line is the same sanitized sentence the student sees — it names the
 * variable to fix, never a value, and nothing key-shaped survives it — rather
 * than the raw error, whose request body would carry the whole conversation.
 */
function reportChatError(error: unknown): string {
  const message = describeChatError(error);
  console.warn(`[chat] turn failed: ${message}`);
  return message;
}

// ── Attachments / vision (design spec §6.1) ────────────────────────

/**
 * Reconstruct the uploaded photos for this turn into {@link UploadedImage}s.
 *
 * The chat client uploads each photo to Blob through `POST /api/uploads` and
 * appends a text hint (`[Attached photos: attachment_id=<uuid> name=<name>;
 * ...]`) to the user message; for vision it also includes the image bytes as
 * image/file parts so the model can see them. We pair the hint entries (which
 * carry the durable `attachments.id` a write later claims) with the inline
 * image bytes (the `dataUrl` the model sees) from the latest user message, in
 * order.
 */
function collectAttachments(messages: ModelMessage[]): UploadedImage[] {
  const lastUser = [...messages]
    .reverse()
    .find((m): m is UserModelMessage => m.role === "user");
  if (!lastUser) return [];

  const text = userMessageText(lastUser);
  const hints = parsePhotoHints(text);
  const images = userMessageImages(lastUser);

  if (hints.length === 0 && images.length === 0) return [];

  // Pair hints (attachment_id + name) with inline image bytes by position. Some
  // entries may have only one side: a hint without bytes still feeds the intake
  // layer; bytes without a hint still let the model see the photo.
  const count = Math.max(hints.length, images.length);
  const attachments: UploadedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const hint = hints[i];
    const image = images[i];
    attachments.push({
      attachmentId: hint?.attachmentId ?? "",
      name: hint?.name ?? image?.name ?? `photo-${i + 1}`,
      contentType: image?.contentType ?? "image/jpeg",
      dataUrl: image?.dataUrl,
    });
  }
  return attachments;
}

/** Flatten a user message's text parts into a single string. */
function userMessageText(message: UserModelMessage): string {
  const content = message.content;
  if (typeof content === "string") return content;
  return content
    .filter((p): p is TextPart => p.type === "text")
    .map((p) => p.text)
    .join("\n");
}

interface InlineImage {
  name?: string;
  contentType: string;
  dataUrl: string;
}

/**
 * Extract inline image bytes from a user message as data URLs the model can see.
 * Handles both image parts and file parts with an `image/*` media type.
 */
function userMessageImages(message: UserModelMessage): InlineImage[] {
  const content = message.content;
  if (typeof content === "string") return [];
  const images: InlineImage[] = [];
  for (const part of content) {
    if (part.type === "image") {
      const dataUrl = imageDataToUrl(
        (part as ImagePart).image,
        (part as ImagePart).mediaType
      );
      if (dataUrl) {
        images.push({
          contentType: (part as ImagePart).mediaType ?? "image/jpeg",
          dataUrl,
        });
      }
    } else if (part.type === "file") {
      const file = part as FilePart;
      // mediaType may be a full IANA type ("image/png") or the top-level
      // segment ("image") — accept both.
      if (typeof file.mediaType === "string" && file.mediaType.startsWith("image")) {
        const mime = file.mediaType.includes("/") ? file.mediaType : "image/jpeg";
        const dataUrl = imageDataToUrl(file.data, mime);
        if (dataUrl) {
          images.push({
            name: file.filename,
            contentType: mime,
            dataUrl,
          });
        }
      }
    }
  }
  return images;
}

/** Normalize AI SDK image/file data (URL | data URL | base64 | bytes) to a data URL. */
function imageDataToUrl(
  data: unknown,
  mediaType: string | undefined
): string | undefined {
  const mime = mediaType || "image/jpeg";
  if (data instanceof URL) return data.toString();
  if (typeof data === "string") {
    if (data.startsWith("http://") || data.startsWith("https://")) return data;
    if (data.startsWith("data:")) return data;
    return `data:${mime};base64,${data}`;
  }
  if (data instanceof Uint8Array) {
    return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
  }
  if (data instanceof ArrayBuffer) {
    return `data:${mime};base64,${Buffer.from(data).toString("base64")}`;
  }
  return undefined;
}

const PHOTO_HINT_RE = /\[Attached photos:\s*([^\]]+)\]/i;

interface PhotoHint {
  attachmentId: string;
  name: string;
}

/** Parse the `[Attached photos: attachment_id=… name=…; …]` hint into entries. */
function parsePhotoHints(text: string): PhotoHint[] {
  const block = text.match(PHOTO_HINT_RE);
  if (!block) return [];
  return block[1]
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const id = entry.match(/attachment_id=(\S+)/)?.[1] ?? "";
      const name = entry.match(/name=([^;]+?)\s*$/)?.[1]?.trim() ?? "";
      return { attachmentId: id, name };
    })
    .filter((hint) => hint.attachmentId || hint.name);
}

// ── Helpers (focused tool / manuals) ───────────────────────────────

/**
 * The focused tool's resources, for the manuals to attach. Only that tool's
 * rows are read (spec §3.10, Article 4's "load context lazily"). A failure
 * leaves the manuals as links, never the request.
 */
async function loadResourcesForManuals(toolId: string): Promise<ToolResource[]> {
  try {
    return await listResourcesForTool(toolId);
  } catch (err) {
    console.warn("[chat] failed to load resources for manuals", err);
    return [];
  }
}
