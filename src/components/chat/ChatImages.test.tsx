import type { UIMessage } from "ai";
import userEvent from "@testing-library/user-event";
import { render, screen, within } from "../../../test/utils/render";
import { ChatMessage } from "./ChatMessage";
import type { ChatToolCard, ToolCardsPayload } from "../../lib/capabilities/tool-cards";
import type { IllustrationPayload } from "../../lib/capabilities/illustrations";
import type { ChatT } from "./chat-text";
import { toolStatusLabel } from "./chat-text";

/**
 * Images in the chat (assistant–GUI parity spec, amendment 2026-10-07): the
 * tools an answer is about as cards with their catalogue photo, status and a
 * link (`data-tool-cards`), and a generated illustration, always labelled as
 * one (`data-illustration`).
 */

const t = ((key: string) => key) as unknown as ChatT;

const form4: ChatToolCard = {
  slug: "form-4",
  name: "Form 4",
  category: "Resin 3D Printer",
  status: "Available",
  imageSrc: "/tool-images/form-4.png",
  thumbnails: { base: "/tool-images/thumbs/form-4.abc123", widths: [160, 320], width: 1200, height: 900 },
};

const trotec: ChatToolCard = {
  slug: "trotec-speedy-400",
  name: "Trotec Speedy 400",
  category: "Laser Cutter",
  status: "Offline",
  imageSrc: "",
  thumbnails: null,
};

function message(parts: unknown[]): UIMessage {
  return { id: "m1", role: "assistant", parts } as unknown as UIMessage;
}

function cards(...tools: ChatToolCard[]): { type: string; id: string; data: ToolCardsPayload } {
  return { type: "data-tool-cards", id: `cards-${tools.map((c) => c.slug).join("-")}`, data: { kind: "tool-cards", tools } };
}

describe("the chat's tool cards", () => {
  it("draws each tool's photo, name, category and status, the card a link to its page", async () => {
    render(<ChatMessage message={message([cards(form4), { type: "text", text: "The Form 4 prints in resin." }])} t={t} onInternalNavigate={() => {}} />);

    const list = await screen.findByRole("list", { name: "Tools in this answer" }, { timeout: 5000 });
    const link = within(list).getByRole("link", { name: /Form 4/ });
    expect(link).toHaveAttribute("href", "/tools/form-4");
    expect(within(link).getByText("Resin 3D Printer")).toBeInTheDocument();
    expect(within(link).getByText("Available")).toBeInTheDocument();
    // The catalogue's own thumbnails, never a URL from the model's text.
    expect(link.querySelector("source[type='image/webp']")?.getAttribute("srcset")).toContain("/tool-images/thumbs/form-4.abc123.320.webp");
  });

  it("shows a tool with no photo by its initials and its status word", async () => {
    render(<ChatMessage message={message([cards(trotec)])} t={t} onInternalNavigate={() => {}} />);
    const link = await screen.findByRole("link", { name: /Trotec Speedy 400/ }, { timeout: 5000 });
    expect(within(link).getByText("TS")).toBeInTheDocument();
    expect(within(link).getByText("Offline")).toBeInTheDocument();
  });

  it("puts a turn's cards in one list where the first arrived, each tool once", async () => {
    render(
      <ChatMessage message={message([cards(form4, trotec), { type: "text", text: "Compare them." }, cards(form4)])} t={t} onInternalNavigate={() => {}} />
    );
    const lists = await screen.findAllByRole("list", { name: "Tools in this answer" }, { timeout: 5000 });
    expect(lists).toHaveLength(1);
    expect(within(lists[0]).getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual(["/tools/form-4", "/tools/trotec-speedy-400"]);
  });

  it("closes the chat when a card is opened, like a tool link in the answer", async () => {
    const onInternalNavigate = vi.fn();
    render(<ChatMessage message={message([cards(form4)])} t={t} onInternalNavigate={onInternalNavigate} />);
    const link = await screen.findByRole("link", { name: /Form 4/ }, { timeout: 5000 });
    link.addEventListener("click", (event) => event.preventDefault());
    await userEvent.click(link);
    expect(onInternalNavigate).toHaveBeenCalledOnce();
  });

  it("names the running tool", () => {
    expect(toolStatusLabel("tool-show_tool", t)).toBe("showingTool");
  });
});

describe("the chat's illustrations", () => {
  const plan: IllustrationPayload = {
    kind: "illustration",
    id: "0b9c8a52-6a55-4b7e-9d1f-1d6b8b8e2f10",
    url: "/api/chat/illustrations/0b9c8a52-6a55-4b7e-9d1f-1d6b8b8e2f10",
    width: 1024,
    height: 1024,
    subject: "plan",
  };

  it("draws the picture from our own route with the mark and the fixed caption", async () => {
    render(<ChatMessage message={message([{ type: "data-illustration", id: "i1", data: plan }])} t={t} onInternalNavigate={() => {}} />);

    const image = await screen.findByRole("img", { name: "AI-generated infographic of the plan" }, { timeout: 5000 });
    expect(image).toHaveAttribute("src", plan.url);
    expect(screen.getByText("AI illustration")).toBeInTheDocument();
    expect(
      screen.getByText("AI-generated illustration, not a photo of our equipment. Check the manual and staff for exact steps.")
    ).toBeInTheDocument();
  });

  it("names a concept render as one", async () => {
    render(
      <ChatMessage message={message([{ type: "data-illustration", id: "i2", data: { ...plan, subject: "concept" } }])} t={t} onInternalNavigate={() => {}} />
    );
    expect(await screen.findByRole("img", { name: "AI-generated concept render of the project idea" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("draws nothing for an image that is not our illustration route", () => {
    const { container } = render(
      <ChatMessage
        message={message([{ type: "data-illustration", id: "i3", data: { ...plan, url: "https://images.example.com/printer.png" } }])}
        t={t}
        onInternalNavigate={() => {}}
      />
    );
    expect(container.querySelector("img")).toBeNull();
  });

  it("names the running tool", () => {
    expect(toolStatusLabel("tool-make_illustration", t)).toBe("drawingIllustration");
  });
});
