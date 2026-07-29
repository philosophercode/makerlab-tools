import { render, screen } from "../../test/utils/render";
import type { MakerLabProject } from "./catalog-types";

// ── Mocks ──────────────────────────────────────────────────────────
//
// `ProjectDetail` is an async server component: it awaits
// `getTranslations()` from next-intl/server, which needs a request scope that
// doesn't exist under Vitest. Swap it for a real translator built from the
// shipped `en` catalog, so the assertions below run against the actual strings
// rather than key stubs.
vi.mock("next-intl/server", async () => {
  const { createTranslator } = await import("next-intl");
  const messages = (await import("../../messages/en.json")).default;
  return {
    getTranslations: async (namespace?: string) =>
      // `namespace` is a literal union in next-intl's types; the mock takes the
      // plain string the component passes.
      createTranslator({ locale: "en", messages, namespace: namespace as never }),
  };
});

// next/image and next/link render fine in jsdom, but plain elements keep the
// DOM trivial to assert (same approach as ToolCard.test.tsx).
vi.mock("next/image", () => ({
  __esModule: true,
  default: ({ src, alt }: { src: string; alt: string }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} />
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

import { ProjectDetail } from "./ProjectDetail";

// ── Fixtures ────────────────────────────────────────────────────────

function project(overrides: Partial<MakerLabProject> = {}): MakerLabProject {
  return {
    id: "project-1",
    title: "Lamp from scrap plywood",
    author: "Ada Lovelace",
    body: "## How I made it\n\nCut on the laser, then glued.",
    photos: ["https://files.notion.so/cover.png"],
    tools: [{ id: "tool-form-4", name: "Form 4", slug: "form-4" }],
    link: null,
    materials: ["Plywood"],
    date: "2024-08-12T10:00:00.000Z",
    ...overrides,
  };
}

// The component is async — await it, then hand the element to RTL.
async function renderDetail(overrides: Partial<MakerLabProject> = {}) {
  return render(await ProjectDetail({ project: project(overrides) }));
}

// ── Head ────────────────────────────────────────────────────────────

describe("ProjectDetail", () => {
  it("renders the title, author and date", async () => {
    await renderDetail();

    expect(
      screen.getByRole("heading", { level: 1, name: "Lamp from scrap plywood" })
    ).toBeInTheDocument();
    // "by {author}" from messages/en.json, plus the formatted date.
    expect(screen.getByText(/by Ada Lovelace/)).toHaveTextContent(/2024/);
  });

  it("renders 'Anonymous' verbatim when that is the stored author", async () => {
    await renderDetail({ author: "Anonymous" });
    expect(screen.getByText(/by Anonymous/)).toBeInTheDocument();
  });

  it("omits the date when the project has none", async () => {
    await renderDetail({ date: null });
    expect(screen.getByText("by Ada Lovelace")).toBeInTheDocument();
  });

  it("omits the date when it is unparseable", async () => {
    await renderDetail({ date: "not-a-date" });
    expect(screen.getByText("by Ada Lovelace")).toBeInTheDocument();
  });
});

// ── Markdown body ───────────────────────────────────────────────────

describe("ProjectDetail markdown", () => {
  it("renders the write-up as markdown", async () => {
    await renderDetail({
      body: "## How I made it\n\n- Cut on the laser\n- Glued\n\n[Docs](https://example.com/docs)",
    });

    expect(
      screen.getByRole("heading", { level: 2, name: "How I made it" })
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "https://example.com/docs"
    );
  });

  it("renders GFM tables (remark-gfm is wired)", async () => {
    await renderDetail({
      body: "| Part | Qty |\n| --- | --- |\n| Shade | 1 |",
    });

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "Shade" })).toBeInTheDocument();
  });

  it("does NOT execute a <script> embedded in the body", async () => {
    const globals = globalThis as unknown as { __projectPwned?: boolean };
    delete globals.__projectPwned;

    const { container } = await renderDetail({
      body: "Before\n\n<script>globalThis.__projectPwned = true;</script>\n\nAfter",
    });

    // react-markdown is configured without rehype-raw, so embedded HTML is
    // inert: no script node is created and nothing runs.
    expect(container.querySelector("script")).toBeNull();
    expect(globals.__projectPwned).toBeUndefined();
    expect(screen.getByText(/Before/)).toBeInTheDocument();
    expect(screen.getByText(/After/)).toBeInTheDocument();
  });

  it("does not create live elements from other raw HTML payloads", async () => {
    const { container } = await renderDetail({
      photos: [],
      body: '<img src="x" onerror="globalThis.__projectPwned = true" />\n\n<iframe src="https://evil.example"></iframe>\n\n<a href="javascript:alert(1)">click</a>',
    });

    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("iframe")).toBeNull();
    // The literal markup survives as text, never as an anchor with that href.
    expect(
      container.querySelector('a[href^="javascript:"]')
    ).toBeNull();
  });

  it("renders an empty body without throwing", async () => {
    const { container } = await renderDetail({ body: "" });
    expect(container.querySelector(".project-detail-body")).toBeInTheDocument();
  });
});

// ── Tool backlinks ──────────────────────────────────────────────────

describe("ProjectDetail tool links", () => {
  it("links each tool to its catalog page by slug", async () => {
    await renderDetail({
      tools: [
        { id: "tool-form-4", name: "Form 4", slug: "form-4" },
        {
          id: "tool-trotec-speedy-400",
          name: "Trotec Speedy 400",
          slug: "trotec-speedy-400",
        },
      ],
    });

    expect(screen.getByRole("link", { name: "Form 4" })).toHaveAttribute(
      "href",
      "/tools/form-4"
    );
    expect(
      screen.getByRole("link", { name: "Trotec Speedy 400" })
    ).toHaveAttribute("href", "/tools/trotec-speedy-400");
  });

  it("omits the tools section entirely when no tools resolved", async () => {
    await renderDetail({ tools: [] });
    expect(screen.queryByRole("heading", { name: "Tools used" })).toBeNull();
  });

  it("omits the materials section when there are none", async () => {
    await renderDetail({ materials: [] });
    expect(screen.queryByRole("heading", { name: "Materials" })).toBeNull();
  });

  it("renders material chips", async () => {
    await renderDetail({ materials: ["Plywood", "PLA"] });
    expect(screen.getByText("Plywood")).toBeInTheDocument();
    expect(screen.getByText("PLA")).toBeInTheDocument();
  });

  it("always offers a way back to the gallery", async () => {
    await renderDetail();
    const back = screen.getByRole("link", { name: "‹ Back to all projects" });
    expect(back).toHaveAttribute("href", "/projects");
  });
});

// ── Photos and external link ────────────────────────────────────────

describe("ProjectDetail photos and link", () => {
  it("renders the first photo as the cover and the rest as thumbnails", async () => {
    const { container } = await renderDetail({
      photos: [
        "https://files.notion.so/cover.png",
        "https://files.notion.so/one.png",
        "https://files.notion.so/two.png",
      ],
    });

    const images = Array.from(container.querySelectorAll("img"));
    expect(images.map((img) => img.getAttribute("src"))).toEqual([
      "https://files.notion.so/cover.png",
      "https://files.notion.so/one.png",
      "https://files.notion.so/two.png",
    ]);
    expect(
      container.querySelectorAll(".project-detail-thumb")
    ).toHaveLength(2);
  });

  it("omits the gallery section when there are no photos", async () => {
    const { container } = await renderDetail({ photos: [] });
    expect(container.querySelector(".project-detail-gallery")).toBeNull();
    expect(container.querySelector("img")).toBeNull();
  });

  it("renders the external link as a safe new-tab anchor", async () => {
    await renderDetail({ link: "https://example.com/lamp" });

    const link = screen.getByRole("link", { name: "View project link" });
    expect(link).toHaveAttribute("href", "https://example.com/lamp");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("omits the link button when there is no link", async () => {
    await renderDetail({ link: null });
    expect(screen.queryByRole("link", { name: "View project link" })).toBeNull();
  });
});
