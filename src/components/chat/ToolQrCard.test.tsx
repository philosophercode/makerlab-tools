import type { UIMessage } from "ai";
import { render, screen } from "../../../test/utils/render";
import { ChatMessage } from "./ChatMessage";
import type { ToolQrCardPayload } from "../../lib/capabilities/qr";
import type { ChatT } from "./chat-text";
import { toolStatusLabel } from "./chat-text";

/**
 * The assistant's QR card (QR labels): `get_tool_qr_code`'s `data-tool-qr`
 * part drawn in the conversation as the code with download links.
 */

const payload: ToolQrCardPayload = {
  kind: "tool-qr",
  name: "Form 4",
  slug: "form-4",
  scanUrl: "https://makerlab-ai.vercel.app/tools/form-4?src=qr",
  shortUrl: "makerlab-ai.vercel.app/tools/form-4",
  imageUrl: "/api/qr/form-4?format=svg",
  pngUrl: "/api/qr/form-4?format=png&download=1",
  svgUrl: "/api/qr/form-4?format=svg&download=1",
};

const message = {
  id: "m1",
  role: "assistant",
  parts: [
    { type: "text", text: "Here is the QR code for the Form 4." },
    { type: "data-tool-qr", id: "qr-form-4", data: payload },
  ],
} as unknown as UIMessage;

const t = ((key: string) => key) as unknown as ChatT;

describe("the chat's QR card", () => {
  it("draws the code inline with Download PNG and SVG links", async () => {
    render(<ChatMessage message={message} t={t} onInternalNavigate={() => {}} />);
    const image = await screen.findByRole("img", { name: "QR code that opens the Form 4 page" });
    expect(image).toHaveAttribute("src", payload.imageUrl);
    expect(screen.getByRole("link", { name: "Download PNG" })).toHaveAttribute("href", payload.pngUrl);
    expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute("href", payload.svgUrl);
    expect(screen.getByText("Scanning it opens makerlab-ai.vercel.app/tools/form-4")).toBeInTheDocument();
  });

  it("names the running tool", () => {
    expect(toolStatusLabel("tool-get_tool_qr_code", t)).toBe("makingQrCode");
  });
});
