import { fireEvent, render, screen } from "../../test/utils/render";
import { ToolCard } from "./ToolCard";
import {
  availableTool,
  inUseTool,
  offlineTool,
} from "../../test/fixtures/catalog";

// next/image and next/link render fine in jsdom, but mocking them to plain
// elements keeps these unit tests deterministic (no Next image-optimization
// internals, no router context) and makes the rendered DOM trivial to assert.
vi.mock("next/image", () => ({
  __esModule: true,
  // Strip Next-only props (fill, sizes) so React doesn't warn about unknown
  // attributes on a plain <img>.
  default: ({ src, alt, onError }: { src: string; alt: string; onError?: () => void }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} onError={onError} />
  ),
}));

vi.mock("next/link", () => ({
  __esModule: true,
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe("ToolCard", () => {
  it("renders the tool name and category", () => {
    render(<ToolCard tool={availableTool} />);

    expect(
      screen.getByRole("heading", { name: "Bandsaw" })
    ).toBeInTheDocument();
    expect(screen.getByText("Woodworking")).toBeInTheDocument();
  });

  it("links to the tool detail page by slug", () => {
    render(<ToolCard tool={availableTool} />);

    const link = screen.getByRole("link", { name: /Bandsaw/ });
    expect(link).toHaveAttribute("href", "/tools/bandsaw");
  });

  it("renders the tool image (decorative alt) with the tool's imageSrc", () => {
    render(<ToolCard tool={availableTool} />);

    // The component renders a decorative image with an empty alt; assert the
    // source rather than an accessible name (which the component does not set).
    const img = document.querySelector("img");
    expect(img).not.toBeNull();
    expect(img).toHaveAttribute("src", availableTool.imageSrc);
    expect(img).toHaveAttribute("alt", "");
  });

  it("says the status as a glyph and a word — never a dot alone", () => {
    render(<ToolCard tool={inUseTool} />);
    expect(screen.getByText("In use")).toBeInTheDocument();
    expect(document.querySelector('[data-glyph="idle"]')).not.toBeNull();
  });

  it("marks an offline tool bad, and still links it", () => {
    render(<ToolCard tool={offlineTool} />);
    expect(screen.getByText("Offline")).toBeInTheDocument();
    expect(document.querySelector('[data-glyph="bad"]')).not.toBeNull();
    expect(screen.getByRole("heading", { name: "Trotec Speedy 400" })).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/tools/trotec-speedy-400");
  });

  it("takes the heading level it is given (h3 under a group)", () => {
    render(<ToolCard tool={availableTool} headingLevel={3} />);
    expect(screen.getByRole("heading", { level: 3, name: "Bandsaw" })).toBeInTheDocument();
  });

  it("shows an empty plate with initials, not a broken image, when the photo is missing", () => {
    render(<ToolCard tool={availableTool} />);
    fireEvent.error(document.querySelector("img")!);
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector('[data-slot="tool-image-empty"]')).toHaveTextContent("B");
  });
});
