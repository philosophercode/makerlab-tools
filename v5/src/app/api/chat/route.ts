import { anthropic } from "@ai-sdk/anthropic";
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
  type UIMessage,
  type UserModelMessage,
} from "ai";
import { getCatalogTool, getCatalogTools } from "../../../lib/catalog";
import { fetchAllResources } from "../../../lib/notion";
import type { MakerLabTool } from "../../../components/catalog-types";
import type { ResourceRecord } from "../../../lib/types";
import { checkRateLimit, type RateLimitDecision } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";
import { siteConfig } from "../../../lib/site-config";
import { chatModel } from "../../../lib/model";
import { CAPABILITIES, composeChat } from "../../../lib/capabilities";
import type {
  CapabilityCtx,
  UploadedImage,
} from "../../../lib/capabilities";

/** Where the "sign in to keep chatting" affordance points. */
const SIGN_IN_PATH = "/api/auth/sign-in/google";

const MAX_PDFS_PER_CHAT = 3;
const MAX_PDF_BYTES = 10 * 1024 * 1024; // 10MB ceiling
const PDF_FETCH_UA = "Mozilla/5.0 (compatible; MakerLabBot/1.0)";

interface AttachedManual {
  title: string;
  url: string;
  /** Base64-encoded PDF bytes, present only if the server-side fetch succeeded. */
  data: string;
}

export const maxDuration = 60;

interface ChatRequest {
  messages: UIMessage[];
  toolId?: string;
  locale?: string;
}

export async function POST(req: Request) {
  // Who is asking, then how much they are allowed — both before any expensive
  // work (Notion fetch / model call). Anonymous visitors get a small allowance
  // keyed by hashed IP; signed-in callers get a generous one keyed by user id
  // (auth design spec §8).
  const identity = await resolveIdentity(req);
  const decision = await checkRateLimit("chat", identity);
  if (!decision.allowed) {
    return rateLimitedResponse(decision);
  }

  const { messages, toolId, locale }: ChatRequest = await req.json();
  const tools = await getCatalogTools();
  const focused = toolId ? await getCatalogTool(toolId) : null;
  const { manuals, skipped } = focused
    ? await collectToolManuals(focused.id)
    : { manuals: [], skipped: 0 };
  if (focused) {
    const hosts = uniqueHosts(focused.links.map((l) => l.href));
    console.info(
      `[chat] focused tool: ${focused.name} (${focused.id}), links: ${focused.links.length}`
    );
    console.info(
      `[chat] web_fetch allowedDomains: ${hosts.length ? hosts.join(", ") : "empty"}`
    );
    console.info(`[chat] manuals attached: ${manuals.length}`);
    console.info(`[chat] manuals skipped (will web_fetch): ${skipped}`);
  }

  // Convert the UI messages, attach any server-fetched manuals, and surface the
  // uploaded photos for this turn both to the model (image bytes — design spec
  // §6.1) and to the capability layer (file_upload ids the intake `create_tool`
  // re-uses to attach the same photo to the new Notion page).
  const baseMessages = await convertToModelMessages(messages);
  const attachments = collectAttachments(baseMessages);
  if (attachments.length > 0) {
    console.info(`[chat] attachments for this turn: ${attachments.length}`);
  }
  const modelMessages = attachManualsToFirstUserMessage(baseMessages, manuals);

  const stream = createUIMessageStream({
    // Surface a useful, user-facing reason instead of the SDK's masked default
    // (e.g. distinguish an Anthropic "overloaded" 529 from a real bug).
    onError: describeChatError,
    execute: ({ writer }) => {
      if (manuals.length > 0) {
        writer.write({
          type: "data-manuals-attached",
          data: { titles: manuals.map((m) => m.title) },
          transient: true,
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
      };

      // Compose the system prompt + capability tools from the shared registry,
      // then add the provider-native research tools (Anthropic web tools are not
      // capabilities — the intake capability's prompt tells the agent to use
      // them). web_fetch keeps the focused-tool domain allow-list.
      const { tools: capabilityTools, system } = composeChat(CAPABILITIES, ctx, {
        tools,
        focusedTool: focused,
        locale,
      });

      const result = streamText({
        model: chatModel,
        system: appendManualSections(system, focused, manuals),
        messages: modelMessages,
        tools: {
          ...capabilityTools,
          web_search: anthropic.tools.webSearch_20250305({
            maxUses: 5,
          }),
          web_fetch: anthropic.tools.webFetch_20250910({
            maxUses: 5,
            maxContentTokens: 20000,
            citations: { enabled: true },
            ...(focused
              ? (() => {
                  const hosts = uniqueHosts(focused.links.map((l) => l.href));
                  return hosts.length ? { allowedDomains: hosts } : {};
                })()
              : {}),
          }),
        },
        stopWhen: stepCountIs(10),
      });

      writer.merge(result.toUIMessageStream({ onError: describeChatError }));
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
 * Map a streaming/model error to a concise, user-facing message. The AI SDK
 * masks error text by default ("An error occurred"); this surfaces the actual
 * reason so users aren't left with a dead-end "Something went wrong" — most
 * importantly distinguishing a transient Anthropic overload (HTTP 529) from a
 * genuine bug. Returned text is shown verbatim in the chat error row.
 */
function describeChatError(error: unknown): string {
  const err = error as
    | { statusCode?: number; status?: number; message?: string; name?: string }
    | undefined;
  const status = err?.statusCode ?? err?.status;
  const message = (err?.message || "").toLowerCase();

  if (status === 529 || message.includes("overloaded")) {
    return "The AI service is temporarily overloaded (this is on the provider's side, not your request). Please try again in a few moments.";
  }
  if (status === 429 || message.includes("rate limit") || message.includes("too many requests")) {
    return "Too many requests right now — please wait a moment and try again.";
  }
  if (message.includes("timeout") || message.includes("timed out") || err?.name === "TimeoutError") {
    return "The request took too long and timed out. Please try again.";
  }
  if (status === 401 || status === 403 || message.includes("api key") || message.includes("authentication")) {
    return "The assistant is misconfigured (authentication failed). Please let a lab admin know.";
  }
  const detail = err?.message?.trim();
  return detail
    ? `Something went wrong: ${detail}`
    : "Something went wrong. Please try again.";
}

// ── Attachments / vision (design spec §6.1) ────────────────────────

/**
 * Reconstruct the uploaded photos for this turn into {@link UploadedImage}s.
 *
 * The chat client uploads each photo to Notion and appends a text hint
 * (`[Attached photos: file_upload_id=<id> name=<name>; ...]`) to the user
 * message; for vision it also includes the image bytes as image/file parts so
 * Claude can see them. We pair the hint entries (which carry the durable Notion
 * `file_upload_id` the intake `create_tool` re-uses) with the inline image bytes
 * (the `dataUrl` the model sees) from the latest user message, in order.
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

  // Pair hints (file_upload_id + name) with inline image bytes by position. Some
  // entries may have only one side: a hint without bytes still feeds the intake
  // layer; bytes without a hint still let the model see the photo.
  const count = Math.max(hints.length, images.length);
  const attachments: UploadedImage[] = [];
  for (let i = 0; i < count; i += 1) {
    const hint = hints[i];
    const image = images[i];
    attachments.push({
      file_upload_id: hint?.file_upload_id ?? "",
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
  file_upload_id: string;
  name: string;
}

/** Parse the `[Attached photos: file_upload_id=… name=…; …]` hint into entries. */
function parsePhotoHints(text: string): PhotoHint[] {
  const block = text.match(PHOTO_HINT_RE);
  if (!block) return [];
  return block[1]
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const id = entry.match(/file_upload_id=(\S+)/)?.[1] ?? "";
      const name = entry.match(/name=([^;]+?)\s*$/)?.[1]?.trim() ?? "";
      return { file_upload_id: id, name };
    })
    .filter((hint) => hint.file_upload_id || hint.name);
}

// ── Helpers (focused tool / manuals) ───────────────────────────────

function uniqueHosts(urls: string[]): string[] {
  const set = new Set<string>();
  for (const u of urls) {
    try {
      set.add(new URL(u).hostname);
    } catch {
      // skip malformed URLs
    }
  }
  return [...set];
}

function isPdfUrl(url: string | undefined): boolean {
  if (!url) return false;
  const cleaned = url.split("?")[0].toLowerCase();
  return cleaned.endsWith(".pdf");
}

function pickPdfUrl(resource: ResourceRecord): string | null {
  if (isPdfUrl(resource.fields.url)) return resource.fields.url ?? null;
  const file = (resource.fields.files || []).find(
    (f) => isPdfUrl(f.filename) || isPdfUrl(f.url)
  );
  return file?.url || null;
}

/**
 * Fetch a PDF server-side (from the Vercel function, not Anthropic's fetcher)
 * and return it base64-encoded. Returns null on any failure so the caller can
 * fall back to web_fetch instead of 400-ing the whole chat request.
 */
async function fetchPdfAsBase64(
  title: string,
  url: string
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": PDF_FETCH_UA },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.warn(
        "[chat] PDF fetch failed, will rely on web_fetch:",
        title,
        url,
        `status ${res.status}`
      );
      return null;
    }
    const buf = await res.arrayBuffer();
    if (buf.byteLength > MAX_PDF_BYTES) {
      console.warn(
        "[chat] PDF too large, will rely on web_fetch:",
        title,
        url,
        `${buf.byteLength} bytes`
      );
      return null;
    }
    return Buffer.from(buf).toString("base64");
  } catch (err) {
    console.warn("[chat] PDF fetch failed, will rely on web_fetch:", title, url, err);
    return null;
  }
}

async function collectToolManuals(
  toolId: string
): Promise<{ manuals: AttachedManual[]; skipped: number }> {
  let resources: ResourceRecord[];
  try {
    resources = await fetchAllResources();
  } catch (err) {
    console.warn("[chat] failed to load resources for manuals", err);
    return { manuals: [], skipped: 0 };
  }

  const forTool = resources.filter(
    (r) => r.fields.published !== false && (r.fields.tool || []).includes(toolId)
  );

  const manuals: AttachedManual[] = [];
  let skipped = 0;
  try {
    for (const r of forTool) {
      const url = pickPdfUrl(r);
      if (!url) {
        if (r.fields.url) {
          console.info(
            `[chat] skipping non-PDF resource: ${r.fields.title} (${r.fields.url})`
          );
        }
        continue;
      }
      if (manuals.length >= MAX_PDFS_PER_CHAT) {
        console.info(
          `[chat] PDF cap reached (${MAX_PDFS_PER_CHAT}); skipping: ${r.fields.title}`
        );
        continue;
      }
      const title = r.fields.title || "Manual";
      const data = await fetchPdfAsBase64(title, url);
      if (!data) {
        skipped += 1;
        continue;
      }
      manuals.push({ title, url, data });
    }
  } catch (err) {
    // Never let base64 collection take down the request; fall back to web_fetch.
    console.warn("[chat] manual collection failed, falling back to web_fetch", err);
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
    // Base64 of bytes we fetched server-side — avoids handing Anthropic a URL
    // it can't fetch (e.g. hosts that block its fetcher, returning a 400).
    data: m.data,
    filename: `${m.title}.pdf`,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
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
    `## Available manuals\n\nThe following PDF manuals are attached to this conversation as documents — Claude can read both their text and figures directly:\n\n${list}`
  );

  if (focused && focused.links.length > 0) {
    const attachedUrls = new Set(manuals.map((m) => m.url));
    const annotated = focused.links
      .map((link) => {
        const tag = attachedUrls.has(link.href) ? " (attached)" : "";
        return `- [${link.kind || "Resource"}] ${link.label} — ${link.href}${tag}`;
      })
      .join("\n");
    sections.push(
      `## Attached manuals vs. fetchable resources\n\nItems marked "(attached)" below are already inlined above as PDF documents — read them directly instead of calling \`web_fetch\`. If an attached PDF was expected to answer the question but you can't actually read it (rare — usually means Anthropic's fetch was blocked by the host), call \`web_fetch\` on the same URL as a fallback.\n\n${annotated}`
    );
  }

  return sections.join("\n\n");
}
