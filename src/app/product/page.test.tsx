/**
 * `/product` (identity spec amendment 2026-09-28 "Product page and quick
 * start"): what it is and a way to try it, the video with its captions and
 * transcript, operate / debug / create, every feature with a screenshot,
 * what it costs to run (never a price), privacy and credits.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import ProductPage, { metadata } from "./page";
import { COST_ROWS, FEATURES, SHOTS, TRY_IT_HREF, WALKTHROUGH } from "./product-content";
import { render, screen, within } from "../../../test/utils/render";

const PUBLIC = join(__dirname, "../../../public");

describe("/product", () => {
  it("names the assistant in the h1 and offers Try it on the X1-Carbon, then Quick start", () => {
    render(<ProductPage />);

    expect(screen.getByRole("heading", { level: 1, name: "MakerLAB AI" })).toBeInTheDocument();
    const tryIt = screen.getAllByRole("link", { name: "Try it" });
    expect(tryIt.length).toBeGreaterThan(0);
    for (const link of tryIt) expect(link).toHaveAttribute("href", "/tools/bambu-lab-x1-carbon-combo-3d-printer?ask=1");
    expect(TRY_IT_HREF).toBe("/tools/bambu-lab-x1-carbon-combo-3d-printer?ask=1");
    for (const link of screen.getAllByRole("link", { name: "Quick start" })) expect(link).toHaveAttribute("href", "/product/quick-start");
  });

  it("reads in product-page order", () => {
    render(<ProductPage />);

    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "See it in under a minute",
      "Operate, debug, create",
      "What's in it",
      "What it costs to run",
      "Privacy and safety",
      "Who made it",
      "Try it on a real machine",
    ]);
  });

  it("asks one real question per pillar, each with its answer's screenshot", () => {
    render(<ProductPage />);

    const pillars = screen.getByRole("region", { name: "Operate, debug, create" });
    for (const label of ["Operate", "Debug", "Create"]) expect(within(pillars).getByRole("heading", { level: 3, name: label })).toBeInTheDocument();
    expect(pillars).toHaveTextContent("What does the quick start guide say about the first print?");
    expect(within(pillars).getAllByRole("img")).toHaveLength(3);
  });

  it("gives every feature a heading and a described screenshot, captioned live or demo", () => {
    render(<ProductPage />);

    const features = screen.getByRole("region", { name: "What's in it" });
    const articles = within(features).getAllByRole("article");
    expect(articles).toHaveLength(FEATURES.length);
    for (const article of articles) {
      const img = within(article).getByRole("img");
      expect(img.getAttribute("alt")?.length).toBeGreaterThan(20);
      expect(img).toHaveAttribute("loading", "lazy");
      expect(article.querySelector("figcaption")?.textContent).toMatch(/^(Demo data|Live site, 2026-09-28)$/);
    }
    expect(within(features).getByRole("heading", { level: 3, name: "Anything the admin screens do, from a sentence" })).toBeInTheDocument();
    expect(features).toHaveTextContent("never touches the super admin role");
  });

  it("loads the first screenshot eagerly and serves AVIF and WebP at two widths", () => {
    render(<ProductPage />);

    const hero = screen.getAllByRole("img")[0];
    expect(hero).toHaveAttribute("loading", "eager");
    expect(hero).toHaveAttribute("fetchpriority", "high");
    const sources = hero.closest("picture")!.querySelectorAll("source");
    expect([...sources].map((s) => s.getAttribute("type"))).toEqual(["image/avif", "image/webp"]);
    expect(sources[0].getAttribute("srcset")).toBe("/product/tool-page-1280.avif 1280w, /product/tool-page-2560.avif 2560w");
  });

  it("has a captioned video that never autoplays, and a transcript", () => {
    const { container } = render(<ProductPage />);

    const video = container.querySelector("video")!;
    expect(video).toHaveAttribute("preload", "none");
    expect(video).not.toHaveAttribute("autoplay");
    expect(video.querySelector("track[kind='captions']")).toHaveAttribute("src", WALKTHROUGH.captions);
    expect(screen.getByText("What happens in the video")).toBeInTheDocument();
  });

  it("states unit costs to run, dated as estimates, and no subscription price", () => {
    render(<ProductPage />);

    const costs = screen.getByRole("region", { name: "What it costs to run" });
    expect(within(costs).getAllByRole("row")).toHaveLength(COST_ROWS.length + 2);
    expect(costs).toHaveTextContent("≈ $0.0003");
    expect(costs).toHaveTextContent("$0.02–0.05");
    expect(costs).toHaveTextContent("20 manuals, 1,136 pages, cost $0.013 on 2026-09-28");
    expect(costs).toHaveTextContent("as of 2026-09-28");
    expect(costs).not.toHaveTextContent(/\$2,400|\$6,000|per year|\/yr/);
  });

  it("covers privacy and credits the people who made and run it", () => {
    render(<ProductPage />);

    const privacy = screen.getByRole("region", { name: "Privacy and safety" });
    expect(privacy).toHaveTextContent("Cornell Google account");
    expect(within(privacy).getByRole("link", { name: "What MakerLAB AI can and can't do, by role" })).toHaveAttribute("href", "/assistant");
    const credits = screen.getByRole("region", { name: "Who made it" });
    expect(credits).toHaveTextContent("Isaac Steinberg (Software Engineer and Architect, Johnson Cornell Tech MBA '26) with Claude-assisted development");
    expect(credits).toHaveTextContent("Niti Parikh (Director) and Luis Rodrigo Navarro (Assistant Director)");
    expect(within(credits).getByRole("link", { name: "About the MakerLAB" })).toHaveAttribute("href", "/about");
  });

  it("has a title, description and Open Graph image", () => {
    expect(metadata.title).toBe("MakerLAB AI");
    expect(metadata.description).toMatch(/operate, debug and create/);
    expect(metadata.openGraph?.images).toEqual([expect.objectContaining({ url: "/product/og.png", width: 1200, height: 630 })]);
  });

  it("ships every file it references", () => {
    for (const shot of Object.values(SHOTS)) {
      for (const width of [Math.round(shot.width / 2), shot.width]) {
        for (const format of ["avif", "webp"]) expect(existsSync(join(PUBLIC, `product/${shot.name}-${width}.${format}`))).toBe(true);
      }
    }
    for (const file of [WALKTHROUGH.mp4, WALKTHROUGH.webm, WALKTHROUGH.poster, WALKTHROUGH.captions, "/product/og.png"]) {
      expect(existsSync(join(PUBLIC, file))).toBe(true);
    }
  });
});
