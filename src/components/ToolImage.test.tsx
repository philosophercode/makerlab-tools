import { fireEvent, render } from "../../test/utils/render";
import { ToolImage } from "./ToolImage";
import { cardImagePriority } from "./GalleryShell";
import type { ImageThumbnails } from "@/lib/images/thumbnail-urls";

// next/image as a plain <img> that shows the props it was given.
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt, loading, fetchPriority, sizes }: { src: string; alt: string; loading?: "eager" | "lazy"; fetchPriority?: string; sizes?: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} loading={loading} fetchPriority={fetchPriority as "high" | undefined} sizes={sizes} data-next-image="" />
  ),
}));

const SET: ImageThumbnails = { base: "/tool-images/thumbs/form-4.abc", widths: [160, 320, 640], width: 1408, height: 768 };

describe("ToolImage", () => {
  it("serves thumbnails as AVIF then WebP sources with the caller's sizes, and a WebP fallback", () => {
    const { container } = render(<ToolImage src="/tool-images/Form%204.png" thumbnails={SET} name="Form 4" sizes="200px" />);
    const sources = container.querySelectorAll("picture source");
    expect([...sources].map((s) => s.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    expect(sources[0].getAttribute("srcset")).toBe(
      "/tool-images/thumbs/form-4.abc.160.avif 160w, /tool-images/thumbs/form-4.abc.320.avif 320w, /tool-images/thumbs/form-4.abc.640.avif 640w"
    );
    expect(sources[0].getAttribute("sizes")).toBe("200px");

    const img = container.querySelector("picture img")!;
    expect(img).toHaveAttribute("src", "/tool-images/thumbs/form-4.abc.320.webp");
    // Intrinsic size for the aspect ratio; contained, never cropped.
    expect(img).toHaveAttribute("width", "1408");
    expect(img).toHaveAttribute("height", "768");
    expect(img.className).toContain("object-contain");
    // Lazy unless told otherwise.
    expect(img).toHaveAttribute("loading", "lazy");
    expect(img).not.toHaveAttribute("fetchpriority");
    // The original is never requested when thumbnails exist.
    expect(container.querySelector("[data-next-image]")).toBeNull();
  });

  it("fetches the LCP image eagerly and first", () => {
    const { container } = render(<ToolImage src="/x.png" thumbnails={SET} name="Form 4" sizes="200px" priority="high" />);
    const img = container.querySelector("picture img")!;
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("fetchpriority", "high");
  });

  it("falls back to next/image on the original when there are no thumbnails", () => {
    const { container } = render(<ToolImage src="https://blob.example/a.jpg" name="Saw" sizes="200px" priority="eager" />);
    expect(container.querySelector("picture")).toBeNull();
    const img = container.querySelector("[data-next-image]")!;
    expect(img).toHaveAttribute("src", "https://blob.example/a.jpg");
    expect(img).toHaveAttribute("loading", "eager");
    expect(img).toHaveAttribute("sizes", "200px");
  });

  it("draws the empty plate for a tool with no photo, requesting nothing", () => {
    const { container } = render(<ToolImage src="" thumbnails={null} name="New Thing" sizes="200px" />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector('[data-slot="tool-image-empty"]')).toHaveTextContent("NT");
  });

  it("draws the empty plate when a thumbnail fails to load", () => {
    const { container } = render(<ToolImage src="/x.png" thumbnails={SET} name="Form 4" sizes="200px" />);
    fireEvent.error(container.querySelector("picture img")!);
    expect(container.querySelector('[data-slot="tool-image-empty"]')).toHaveTextContent("F4");
  });
});

describe("cardImagePriority", () => {
  it("fetches the first row eagerly (the first two first) and the rest lazily", () => {
    expect([0, 1, 2, 3, 4, 5, 20].map(cardImagePriority)).toEqual(["high", "high", "eager", "eager", "eager", "lazy", "lazy"]);
  });
});
