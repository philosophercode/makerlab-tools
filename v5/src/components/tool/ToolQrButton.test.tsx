import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import { ToolQrButton } from "./ToolQrButton";

/**
 * The tool page's QR dialog (QR labels): the code from the image route,
 * downloads as attachments, Copy link, and Share only where the browser has
 * a share sheet — with the PNG as a file where it can share files.
 */

const props = {
  slug: "form-4",
  toolName: "Form 4",
  pageUrl: "https://makerlab-ai.vercel.app/tools/form-4",
  scanUrl: "https://makerlab-ai.vercel.app/tools/form-4?src=qr",
};

async function open(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "QR code & share" }));
  return screen.getByRole("dialog");
}

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, "share");
  Reflect.deleteProperty(navigator, "canShare");
});

describe("ToolQrButton", () => {
  it("is a quiet trigger with no dialog until clicked", () => {
    render(<ToolQrButton {...props} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows the code and the download links", async () => {
    const user = userEvent.setup();
    render(<ToolQrButton {...props} />);
    const dialog = await open(user);
    expect(dialog).toHaveAccessibleName("QR code for Form 4");
    const image = screen.getByRole("img", { name: "QR code that opens the Form 4 page" });
    expect(image).toHaveAttribute("src", "/api/qr/form-4?format=svg");
    expect(image).toHaveAttribute("data-qr-scan", props.scanUrl);
    expect(screen.getByRole("link", { name: "Download PNG" })).toHaveAttribute("href", "/api/qr/form-4?format=png&size=1024&download=1");
    expect(screen.getByRole("link", { name: "Download SVG" })).toHaveAttribute("href", "/api/qr/form-4?format=svg&download=1");
    expect(screen.getByText("makerlab-ai.vercel.app/tools/form-4")).toBeInTheDocument();
    // No share sheet in jsdom: no Share button.
    expect(screen.queryByRole("button", { name: "Share…" })).not.toBeInTheDocument();
  });

  it("copies the plain page link", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue();
    render(<ToolQrButton {...props} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(props.pageUrl);
    expect(await screen.findByRole("button", { name: "Link copied" })).toBeInTheDocument();
  });

  it("says so when the clipboard refuses", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(new Error("denied"));
    render(<ToolQrButton {...props} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Copy link" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not copy the link");
  });

  it("shares the PNG as a file where the browser can", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    Object.defineProperty(navigator, "canShare", { value: () => true, configurable: true });
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["png"], { type: "image/png" })));
    const user = userEvent.setup();
    render(<ToolQrButton {...props} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalled());
    expect(fetchSpy).toHaveBeenCalledWith("/api/qr/form-4?format=png&size=1024");
    const data = share.mock.calls[0][0] as ShareData;
    expect(data.url).toBe(props.pageUrl);
    expect(data.files?.[0].name).toBe("form-4-qr.png");
  });

  it("falls back to sharing the link when files cannot be shared", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "share", { value: share, configurable: true });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(new Blob(["png"])));
    const user = userEvent.setup();
    render(<ToolQrButton {...props} />);
    await open(user);
    await user.click(screen.getByRole("button", { name: "Share…" }));
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: "QR code for Form 4", url: props.pageUrl }));
  });
});
