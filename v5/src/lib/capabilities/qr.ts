import { z } from "zod";
import { getCatalogTool, getCatalogTools } from "../catalog";
import { qrSiteUrl } from "../qr/site-url";
import { displayUrl, qrImagePath, toolQrTargetUrl } from "../qr/urls";
import { findTool } from "./helpers";
import type { Capability, CapabilityTool } from "./types";

/**
 * The `qr` capability (QR labels): "can I have a QR code for this device?"
 *
 * `get_tool_qr_code` resolves a **published** tool — by id, slug or name, or
 * the tool whose page the person is on — and answers with the code's scan
 * address and the `/api/qr/<slug>` image links. In the chat it also writes a
 * `data-tool-qr` part, which `ChatMessage` draws as the code with Download
 * PNG / SVG links (`components/chat/ToolQrCard.tsx`).
 *
 * - **A read, for everybody**, anonymous visitors included: no permission,
 *   no sign-in, and it records nothing. It is not a proposal, so the
 *   confirmation card and the taint rules for writes do not apply; it returns
 *   only the lab's own catalogue data, so it does not taint a turn either.
 * - **Published tools only, for staff too.** A draft has no public page for a
 *   code to open, so a draft reads as "not found" here as it does on the image
 *   route.
 * - **Chat only.** Over MCP the same image is one GET of `/api/qr/<slug>`,
 *   which a client can fetch itself; a tool that answers with a picture card
 *   has no meaning headlessly.
 */

const input = z.object({
  tool: z
    .string()
    .max(200)
    .optional()
    .describe("The tool's id, slug or name. Leave it out on a tool's own page to use that tool."),
});
type Input = z.infer<typeof input>;

/** The chat card's payload (`data-tool-qr`). */
export interface ToolQrCardPayload {
  kind: "tool-qr";
  name: string;
  slug: string;
  /** What the code encodes. */
  scanUrl: string;
  /** The same address as printed under a label. */
  shortUrl: string;
  imageUrl: string;
  pngUrl: string;
  svgUrl: string;
}

type Result =
  | { found: true; name: string; slug: string; scan_url: string; page: string; png_download: string; svg_download: string }
  | { found: false; message: string };

async function resolvePublishedTool(needle: string) {
  return (await getCatalogTool(needle)) ?? findTool(await getCatalogTools(), needle);
}

export const getToolQrCode: CapabilityTool<Input, Result> = {
  name: "get_tool_qr_code",
  description:
    "Get the QR code for a published tool — the code on the lab's machine labels, which opens the tool's page. Shows the code in the chat with Download PNG and SVG links. Use when someone asks for a QR code, label or sticker for a tool.",
  inputSchema: input,
  kind: "read",
  chatOnly: true,
  async run({ tool: asked }, ctx) {
    const needle = asked?.trim() || ctx.focusedToolId || "";
    if (!needle) return { found: false, message: "Which tool? Name it, or ask from the tool's own page." };
    const tool = await resolvePublishedTool(needle);
    if (!tool) {
      return { found: false, message: `No published tool matches "${needle.slice(0, 80)}". Only published tools have QR codes.` };
    }
    const scanUrl = toolQrTargetUrl(qrSiteUrl(), tool.slug);
    const payload: ToolQrCardPayload = {
      kind: "tool-qr",
      name: tool.name,
      slug: tool.slug,
      scanUrl,
      shortUrl: displayUrl(scanUrl),
      imageUrl: qrImagePath(tool.slug, "svg"),
      pngUrl: qrImagePath(tool.slug, "png", { download: true }),
      svgUrl: qrImagePath(tool.slug, "svg", { download: true }),
    };
    ctx.writer?.write({ type: "data-tool-qr", id: `qr-${tool.slug}`, data: payload });
    return {
      found: true,
      name: tool.name,
      slug: tool.slug,
      scan_url: scanUrl,
      page: `/tools/${tool.slug}`,
      png_download: payload.pngUrl,
      svg_download: payload.svgUrl,
    };
  },
};

const QR_SECTION = `## QR codes\n\nWhen someone asks for a QR code, a label or a sticker for a tool ("can I have a QR code for this?"), call \`get_tool_qr_code\` with the tool — leave \`tool\` out when they are on that tool's page. The chat shows the code under your answer with Download PNG and Download SVG links, so do not write the image or the links yourself: say in a sentence that scanning it opens the tool's page. Only published tools have codes. Lab staff print sheets of labels from Inventory → QR labels.`;

export const qr: Capability = {
  id: "qr",
  promptFragment: () => QR_SECTION,
  tools: [getToolQrCode as CapabilityTool<unknown, unknown>],
};
