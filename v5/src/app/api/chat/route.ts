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
import type { MakerLabTool } from "../../../components/catalog-types";
import { checkRateLimit, type RateLimitDecision } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";
import { siteConfig } from "../../../lib/site-config";
import { chatProviderOptions, languageModelFor } from "../../../lib/ai/models";
import { chatExaSearch, EXA_SEARCH_TOOL } from "../../../lib/ai/exa";
import { describeChatError } from "../../../lib/chat/describe-chat-error";
import { resourceHosts } from "../../../lib/capabilities/web";
import { fetchManualPdf, type ManualPdfSource } from "../../../lib/chat/fetch-manual-pdf";
import { cachedManualPdf } from "../../../lib/chat/manual-pdf-cache";
import { loadToolManualsForChat } from "../../../lib/chat/tool-manuals";
import { curationForChat, recordSearchResults } from "../../../lib/chat/curation";
import { markOutsideReads, newTurnState } from "../../../lib/chat/taint";
import { curationCapability } from "../../../lib/capabilities/curation";
import { loadPageContext, pageContextSection } from "../../../lib/actions/page-context";
import { loadProposalOutcomes } from "../../../lib/chat/proposal-outcomes";
import { recordChatTurnUsage } from "../../../lib/usage/chat-turn";
import { chatPrepareStep } from "./prepare-step";
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

const MAX_PDFS_PER_CHAT = 3;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB ceiling
const PDF_FETCH_UA = "Mozilla/5.0 (compatible; MakerLabBot/1.0)";
const PDF_FETCH_TIMEOUT_MS = 8000;

interface AttachedManual {
  title: string;
  url: string;
  /**
   * The resource's own link when `url` is its archived copy. The tool page's
   * links come from a cached read that may predate the copy, so "(attached)"
   * matches either.
   */
  sourceUrl?: string;
  /** Base64-encoded PDF bytes, present only if the server-side fetch succeeded. */
  data: string;
}

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
  const { messages, toolId, locale, pendingId, id: rawChatId, page } = body;
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
        writer.write({
          type: "data-manual-links",
          data: { kind: "manual-links", links: manuals.map((m) => ({ title: m.title, url: m.url })) },
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
        system: [appendManualSections(system, focused, manuals), pageContextSection(pageContext), outcomes]
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

function isPdfUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const cleaned = url.split("?")[0].toLowerCase();
  return cleaned.endsWith(".pdf");
}

/**
 * The PDF to attach for one resource: its archived copy in Blob first (the
 * manual archive — it outlives the manufacturer's link, and matches the href
 * the tool's links carry, which keeps "(attached)" honest), then the source
 * link, then an uploaded file. One per resource, so a manual is never attached
 * twice. `ownStore` marks the copies our own uploaders wrote; the source link
 * is the web's, and is fetched through the SSRF guard (`fetch-manual-pdf.ts`).
 */
function pickPdfSource(resource: ToolResource): ManualPdfSource | null {
  if (resource.archivedUrl) return { url: resource.archivedUrl, ownStore: true };
  if (resource.url && isPdfUrl(resource.url)) return { url: resource.url, ownStore: false };
  const uploaded = resource.fileUrls.find(isPdfUrl);
  return uploaded ? { url: uploaded, ownStore: true } : null;
}

/**
 * Fetch a PDF server-side and return it base64-encoded, so the model receives
 * the bytes rather than a URL its provider may not be able to fetch. Returns
 * null on any failure — a blocked or non-PDF answer included; the manual is
 * then only a link in the prompt, and the chat request carries on without it.
 */
async function fetchPdfAsBase64(title: string, source: ManualPdfSource): Promise<string | null> {
  const fetched = await fetchManualPdf(source, {
    maxBytes: MAX_PDF_BYTES,
    timeoutMs: PDF_FETCH_TIMEOUT_MS,
    userAgent: PDF_FETCH_UA,
  });
  if (!fetched.ok) {
    console.warn("[chat] PDF not attached:", title, source.url, fetched.reason);
    return null;
  }
  return Buffer.from(fetched.bytes).toString("base64");
}

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

/**
 * Fetch the manuals to attach: every PDF resource that is not searchable, up to
 * {@link MAX_PDFS_PER_CHAT}, in resource order. They are fetched in parallel —
 * one wave of up to the cap, then another only to replace failures — rather
 * than one after another (performance plan, quick win 8), and a PDF fetched in
 * the last few minutes comes from memory (`manual-pdf-cache.ts`).
 */
async function collectToolManuals(
  forTool: ToolResource[],
  searchableResourceIds: ReadonlySet<string> = new Set()
): Promise<{ manuals: AttachedManual[]; skipped: number }> {
  const candidates: { resource: ToolResource; source: ManualPdfSource }[] = [];
  for (const r of forTool) {
    // Searchable: `search_manual` reads it page by page — never attached, and
    // never counted against MAX_PDFS_PER_CHAT.
    if (searchableResourceIds.has(r.id)) continue;
    const source = pickPdfSource(r);
    if (!source) {
      if (r.url) {
        console.info(`[chat] skipping non-PDF resource: ${r.title} (${r.url})`);
      }
      continue;
    }
    candidates.push({ resource: r, source });
  }

  const manuals: AttachedManual[] = [];
  let skipped = 0;
  try {
    let next = 0;
    while (manuals.length < MAX_PDFS_PER_CHAT && next < candidates.length) {
      const wave = candidates.slice(next, next + (MAX_PDFS_PER_CHAT - manuals.length));
      next += wave.length;
      const fetched = await Promise.all(
        wave.map(({ resource, source }) =>
          cachedManualPdf(source.url, () => fetchPdfAsBase64(resource.title || "Manual", source))
        )
      );
      wave.forEach(({ resource: r, source: { url } }, index) => {
        const data = fetched[index];
        if (!data) {
          skipped += 1;
          return;
        }
        const title = r.title || "Manual";
        manuals.push(
          r.archivedUrl && r.url && url === r.archivedUrl ? { title, url, sourceUrl: r.url, data } : { title, url, data }
        );
      });
    }
    for (const { resource } of candidates.slice(next)) {
      console.info(`[chat] PDF cap reached (${MAX_PDFS_PER_CHAT}); skipping: ${resource.title}`);
    }
  } catch (err) {
    // Never let base64 collection take down the request; the manuals stay links.
    console.warn("[chat] manual collection failed; manuals stay links only", err);
    return { manuals: [], skipped: skipped + manuals.length };
  }
  return { manuals, skipped };
}

function attachManualsToFirstUserMessage(
  messages: ModelMessage[],
  manuals: AttachedManual[]
): ModelMessage[] {
  if (manuals.length === 0) return messages;
  const firstUserIdx = messages.findIndex((m) => m.role === "user");
  if (firstUserIdx === -1) return messages;

  const fileParts: FilePart[] = manuals.map((m) => ({
    type: "file",
    mediaType: "application/pdf",
    // Base64 of bytes we fetched server-side — avoids handing the provider a
    // URL it can't fetch (hosts that block its fetcher answer with an error).
    // A plain file part, with no provider options: every Gateway model reads
    // it, and caching repeated context is the provider's own (spec §3.4).
    data: m.data,
    filename: `${m.title}.pdf`,
  }));

  const target = messages[firstUserIdx] as UserModelMessage;
  const existing = target.content;
  const existingParts: (TextPart | FilePart | ImagePart)[] = Array.isArray(existing)
    ? (existing.filter(
        (p) => p.type === "text" || p.type === "file" || p.type === "image"
      ) as (TextPart | FilePart | ImagePart)[])
    : [{ type: "text", text: String(existing ?? "") }];

  const updated: UserModelMessage = {
    role: "user",
    content: [...fileParts, ...existingParts],
  };
  return [
    ...messages.slice(0, firstUserIdx),
    updated,
    ...messages.slice(firstUserIdx + 1),
  ];
}

/**
 * Append the per-request manual sections to the composed system prompt. These
 * depend on the server-side PDF fetch for the focused tool, so they live in the
 * route rather than the surface-agnostic chat adapter (which only knows the
 * catalog/focused-tool/locale env). When no manuals were attached this is a
 * no-op and the adapter's prompt is returned unchanged.
 */
function appendManualSections(
  system: string,
  focused: MakerLabTool | null,
  manuals: AttachedManual[]
): string {
  if (manuals.length === 0) return system;

  const sections: string[] = [system];

  const list = manuals.map((m) => `- **${m.title}** — ${m.url}`).join("\n");
  sections.push(
    `## Available manuals\n\nThe following PDF manuals are attached to this conversation as documents — read both their text and figures directly:\n\n${list}\n\nThese are not searchable, so there is no \`ref\` to cite them by. Cite a page of one as plain text — "(${manuals[0].title}, p. 12)" — and, if you link the manual, link exactly its address above: never add \`#page=\` to it and never write any other address for it. The chat does not turn a page anchor you write into a link.`
  );

  if (focused && focused.links.length > 0) {
    const attachedUrls = new Set(manuals.flatMap((m) => (m.sourceUrl ? [m.url, m.sourceUrl] : [m.url])));
    const annotated = focused.links
      .map((link) => {
        const tag = attachedUrls.has(link.href) ? " (attached)" : "";
        return `- [${link.kind || "Resource"}] ${link.label} — ${link.href}${tag}`;
      })
      .join("\n");
    sections.push(
      `## Attached manuals vs. readable resources\n\nItems marked "(attached)" below are already inlined above as PDF documents — read them directly; do not call \`read_page\` on them. For a web page among the other links, call \`read_page\` on its exact URL when the answer needs it. \`read_page\` does not read PDFs: for a PDF that is not attached, give the student the link rather than guessing what it says.\n\n${annotated}`
    );
  }

  return sections.join("\n\n");
}
