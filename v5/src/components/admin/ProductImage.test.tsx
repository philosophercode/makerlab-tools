import { fireEvent } from "@testing-library/react";
import { useState } from "react";
import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { ApprovalImageChoice } from "../../lib/data/pending-tools";
import type { ImageCandidate, ResearchImages } from "../../lib/research/result";
import { initialImageChoice, plannedClean, ProductImage, type ProductImageProps } from "./ProductImage";

/**
 * The preliminary page's **Product image** section (gateway spec §6, §10
 * "Component"): every state, keyboard selection, the checkerboard, the
 * attribution link and the preselection rule.
 *
 * What would embarrass us (§10): a cleaned cutout chosen without its original
 * in view; an admin's own photo replaced by a stock image; an empty frame
 * where a sentence should be.
 */

const ID = "6a1f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a01";

function candidate(rank: 1 | 2 | 3, over: Partial<ImageCandidate> = {}): ImageCandidate {
  return {
    url: `https://cdn.prusa3d.com/img/mk4s-${rank}.png`,
    pageUrl: "https://www.prusa3d.com/product/mk4s/",
    source: "og",
    width: 1200,
    height: 900,
    contentType: "image/png",
    rank,
    reason: "The printer.",
    ...over,
  };
}

const THREE: ResearchImages = {
  candidates: [
    candidate(1),
    candidate(2, { pageUrl: null, url: "https://images.example.org/mk4s-side.jpg", source: "exa" }),
    candidate(3),
  ],
  cleaned: { attachmentId: "3c0a8f3e-1111-4c55-9f2a-1b8e7d3c4a01", fromUrl: "https://cdn.prusa3d.com/img/mk4s-1.png" },
};

/** The section as the page uses it: controlled, with the page's own state. */
function Harness(props: Partial<ProductImageProps> & { onChoice?: (choice: ApprovalImageChoice) => void }) {
  const images = "images" in props ? props.images : THREE;
  const hasUploadedPhoto = props.hasUploadedPhoto ?? false;
  const [value, setValue] = useState<ApprovalImageChoice>(() => initialImageChoice(images, hasUploadedPhoto));
  return (
    <>
      <ProductImage
        pendingId={ID}
        name="Prusa MK4S"
        images={images}
        imageError={props.imageError ?? null}
        hasUploadedPhoto={hasUploadedPhoto}
        value={value}
        onChange={(choice) => {
          setValue(choice);
          props.onChoice?.(choice);
        }}
      />
      <output data-testid="choice">{JSON.stringify(value)}</output>
    </>
  );
}

const choice = () => JSON.parse(screen.getByTestId("choice").textContent ?? "null");

describe("ProductImage — candidates with a cleaned copy", () => {
  it("is one radio group labelled Product image, with the three names the E2E relies on", () => {
    render(<Harness />);

    const group = screen.getByRole("radiogroup", { name: "Product image" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(5);
    expect(within(group).getByRole("radio", { name: "Background removed" })).toBeInTheDocument();
    for (const rank of [1, 2, 3]) {
      expect(within(group).getByRole("radio", { name: `Option ${rank}` })).toBeInTheDocument();
    }
    expect(within(group).getByRole("radio", { name: "No image" })).toBeInTheDocument();
  });

  it("preselects the cleaned copy", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Background removed" })).toBeChecked();
    expect(choice()).toEqual({ choice: "cleaned" });
  });

  it("draws the cleaned copy on a checkerboard, from the review route, with its note", () => {
    render(<Harness />);

    const cleaned = screen.getByRole("img", { name: "Prusa MK4S, background removed" });
    expect(cleaned).toHaveAttribute("src", `/api/pending-tools/${ID}/cleaned-image?v=${THREE.cleaned!.attachmentId}`);
    expect(cleaned.parentElement).toHaveAttribute("data-slot", "image-frame");
    expect(cleaned.parentElement).toHaveAttribute("data-checkerboard");
    expect(
      screen.getByText(
        "Background removed automatically: only the plain backdrop was cut away, the product is the original's own pixels."
      )
    ).toBeInTheDocument();
  });

  it("shows the original beside it, marked Original, straight from its source with no referrer", () => {
    render(<Harness />);

    const pair = screen.getByRole("img", { name: "Prusa MK4S, background removed" }).closest(
      '[data-slot="image-pair"]'
    ) as HTMLElement;
    const original = within(pair).getByRole("img", { name: "Prusa MK4S, option 1" });
    expect(original).toHaveAttribute("src", "https://cdn.prusa3d.com/img/mk4s-1.png");
    expect(original).toHaveAttribute("referrerpolicy", "no-referrer");
    expect(original).toHaveAttribute("loading", "lazy");
    expect(within(pair).getByText("Original")).toBeInTheDocument();
    // Only the original is marked so; not the checkerboard, not the cleaned tile.
    expect(original.parentElement).not.toHaveAttribute("data-checkerboard");
  });

  it("credits every tile's page, or the image itself when there is no page", () => {
    render(<Harness />);

    const credits = screen.getAllByRole("link", { name: "From prusa3d.com" });
    // The cleaned tile credits its original's page, so rank 1's page twice, and rank 3.
    expect(credits).toHaveLength(3);
    for (const link of credits) {
      expect(link).toHaveAttribute("href", "https://www.prusa3d.com/product/mk4s/");
      expect(link).toHaveAttribute("rel", "noreferrer noopener");
      expect(link).toHaveAttribute("target", "_blank");
    }
    expect(screen.getByRole("link", { name: "From images.example.org" })).toHaveAttribute(
      "href",
      "https://images.example.org/mk4s-side.jpg"
    );
  });

  it("moves the choice with the arrow keys, within the group", async () => {
    render(<Harness />);

    await userEvent.tab();
    expect(screen.getByRole("radio", { name: "Background removed" })).toHaveFocus();

    await userEvent.keyboard("{ArrowDown}");
    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
    expect(choice()).toEqual({ choice: "original", candidateUrl: "https://cdn.prusa3d.com/img/mk4s-1.png" });

    await userEvent.keyboard("{ArrowDown}");
    expect(choice()).toEqual({ choice: "original", candidateUrl: "https://images.example.org/mk4s-side.jpg" });

    await userEvent.keyboard("{ArrowDown}{ArrowDown}");
    expect(screen.getByRole("radio", { name: "No image" })).toBeChecked();
    expect(choice()).toEqual({ choice: "none" });

    await userEvent.keyboard("{ArrowUp}");
    expect(screen.getByRole("radio", { name: "Option 3" })).toBeChecked();
  });

  it("selects by clicking a picture too", async () => {
    render(<Harness />);
    await userEvent.click(screen.getByRole("img", { name: "Prusa MK4S, option 3" }));
    expect(screen.getByRole("radio", { name: "Option 3" })).toBeChecked();
  });

  it("says when the cleaned copy cannot be shown, and stops offering it", () => {
    render(<Harness />);

    fireEvent.error(screen.getByRole("img", { name: "Prusa MK4S, background removed" }));

    expect(screen.getByText("The background-removed copy could not be shown.")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Background removed" })).toBeDisabled();
    // A copy nobody can see does not stay chosen.
    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
  });
});

describe("ProductImage — crops and banners (amendment \"Composites and product crop\")", () => {
  const cleanedFrom = THREE.cleaned!;

  it("labels a cropped-and-cut copy as such, still on the checkerboard beside its original", () => {
    render(<Harness images={{ ...THREE, cleaned: { ...cleanedFrom, kind: "cropped_and_cut" } }} />);

    const radio = screen.getByRole("radio", { name: "Cropped and background removed" });
    expect(radio).toBeChecked();
    expect(choice()).toEqual({ choice: "cleaned" });
    const picture = screen.getByRole("img", { name: "Prusa MK4S, background removed" });
    expect(picture.parentElement).toHaveAttribute("data-checkerboard");
    expect(screen.getByText(/Cropped to the product and its plain backdrop cut away automatically/)).toBeInTheDocument();
    expect(screen.getByText("Original")).toBeInTheDocument();
  });

  it("labels a crop alone as Cropped to the product, without the checkerboard, and hides the cut's note", () => {
    render(
      <Harness images={{ ...THREE, cleaned: { ...cleanedFrom, kind: "cropped" }, cleanNote: "busy_background" }} />
    );

    expect(screen.getByRole("radio", { name: "Cropped to the product" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: /Background removed/i })).not.toBeInTheDocument();
    const picture = screen.getByRole("img", { name: "Prusa MK4S, cropped to the product" });
    expect(picture).toHaveAttribute("src", `/api/pending-tools/${ID}/cleaned-image?v=${cleanedFrom.attachmentId}`);
    expect(picture.parentElement).not.toHaveAttribute("data-checkerboard");
    expect(screen.getByText(/The background around it could not be removed, so it stays/)).toBeInTheDocument();
    expect(screen.queryByText(/The background was not removed/)).not.toBeInTheDocument();
  });

  it("tags every candidate the ranking judged a composite as a Banner", () => {
    const banners: ResearchImages = {
      candidates: [candidate(1, { composite: true }), candidate(2), candidate(3, { composite: true })],
      cleaned: { ...cleanedFrom, kind: "cropped_and_cut" },
    };
    render(<Harness images={banners} />);

    const tags = screen.getAllByText("Banner");
    expect(tags).toHaveLength(2);
    const firstTile = screen.getByRole("radio", { name: "Option 1" }).closest('[data-slot="image-tile"]') as HTMLElement;
    expect(within(firstTile).getByText("Original")).toBeInTheDocument();
    expect(within(firstTile).getByText("Banner")).toBeInTheDocument();
    const secondTile = screen.getByRole("radio", { name: "Option 2" }).closest('[data-slot="image-tile"]') as HTMLElement;
    expect(within(secondTile).queryByText("Banner")).not.toBeInTheDocument();
    // The radio's name stays "Option N": the tag sits beside the label, not in it.
    expect(screen.getByRole("radio", { name: "Option 3" })).toBeInTheDocument();
  });

  it("keeps the plain wording for a copy recorded before crops existed (no kind)", () => {
    render(<Harness />);
    expect(screen.getByRole("radio", { name: "Background removed" })).toBeInTheDocument();
    expect(screen.queryByText("Banner")).not.toBeInTheDocument();
  });
});

describe("ProductImage — what approval does to a picked candidate (amendment \"The picked image is cleaned too\")", () => {
  const tileOf = (name: string) => screen.getByRole("radio", { name }).closest<HTMLElement>('[data-slot="image-tile"]')!;

  it("says on each other option what approval will do to its background", () => {
    const images: ResearchImages = {
      ...THREE,
      candidates: [
        candidate(1, { background: "plain" }),
        candidate(2, { url: "https://images.example.org/banner.jpg", background: "busy", composite: true, productBox: [0.3, 0.2, 0.7, 0.8] }),
        candidate(3, { background: "busy" }),
      ],
    };
    render(<Harness images={images} />);

    expect(within(tileOf("Option 2")).getByText("Cropped to the product when approved")).toBeInTheDocument();
    expect(within(tileOf("Option 3")).getByText("Busy background — used as it is")).toBeInTheDocument();
    // Rank 1 beside its cleaned copy is the uncut picture: stored as it is, so it promises nothing.
    expect(within(tileOf("Option 1")).queryByText(/when approved/)).not.toBeInTheDocument();
  });

  it("says a plain or unclassified candidate's background is removed when approved", () => {
    render(<Harness images={{ candidates: [candidate(1), candidate(2, { background: "plain" })], cleaned: null }} />);

    expect(within(tileOf("Option 1")).getByText("Background removed when approved")).toBeInTheDocument();
    expect(within(tileOf("Option 2")).getByText("Background removed when approved")).toBeInTheDocument();
  });

  it("promises nothing on a rank 1 whose cut already failed — the reason is said once, above", () => {
    render(<Harness images={{ ...THREE, cleaned: null, cleanNote: "fragmented" }} />);
    expect(within(tileOf("Option 1")).queryByText(/when approved/)).not.toBeInTheDocument();
    expect(within(tileOf("Option 2")).getByText("Background removed when approved")).toBeInTheDocument();
  });

  it("plans from what research recorded", () => {
    expect(plannedClean(candidate(1, { background: "transparent", composite: true }))).toBe("already");
    expect(plannedClean(candidate(1, { composite: true, productBox: [0.1, 0.1, 0.5, 0.5] }))).toBe("crop");
    expect(plannedClean(candidate(1, { composite: true }))).toBe("cut");
    expect(plannedClean(candidate(1, { background: "busy" }))).toBe("busy");
    expect(plannedClean(candidate(1))).toBe("cut");
  });
});

describe("ProductImage — candidates without a cleaned copy", () => {
  it("preselects rank 1, offers no Background removed and no checkerboard", () => {
    render(<Harness images={{ ...THREE, cleaned: null }} />);

    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
    expect(screen.queryByRole("radio", { name: "Background removed" })).not.toBeInTheDocument();
    expect(screen.queryByText("Original")).not.toBeInTheDocument();
    expect(document.querySelector("[data-checkerboard]")).toBeNull();
    expect(screen.getByRole("radio", { name: "No image" })).not.toBeChecked();
  });

  it("draws an already transparent rank 1 on the checkerboard as the clean one, with no cleaned copy stored", () => {
    const transparent: ResearchImages = { candidates: [candidate(1, { background: "transparent" }), candidate(2)], cleaned: null };
    render(<Harness images={transparent} />);

    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
    expect(choice()).toEqual({ choice: "original", candidateUrl: "https://cdn.prusa3d.com/img/mk4s-1.png" });
    expect(screen.queryByRole("radio", { name: "Background removed" })).not.toBeInTheDocument();
    expect(screen.getByText("Already on a clean background")).toBeInTheDocument();
    const picture = screen.getByRole("img", { name: "Prusa MK4S, option 1" });
    expect(picture.parentElement).toHaveAttribute("data-checkerboard");
    expect(screen.getByRole("img", { name: "Prusa MK4S, option 2" }).parentElement).not.toHaveAttribute("data-checkerboard");
  });

  it("says in one line why the background was not removed", () => {
    render(<Harness images={{ ...THREE, cleaned: null, cleanNote: "busy_background" }} />);
    expect(
      screen.getByText("The background was not removed: the best picture is not on a plain backdrop.")
    ).toBeInTheDocument();
    expect(screen.queryByText("Already on a clean background")).not.toBeInTheDocument();
  });

  it("offers a lone candidate and No image", () => {
    render(<Harness images={{ candidates: [candidate(1)], cleaned: null }} />);
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(2);
    expect(screen.getByRole("radio", { name: "Option 1" })).toBeChecked();
  });
});

describe("ProductImage — nothing to choose", () => {
  it("uses the uploaded photo instead of any candidate, and chooses none", () => {
    render(<Harness hasUploadedPhoto />);

    expect(screen.getByRole("heading", { name: "Product image" })).toBeInTheDocument();
    expect(screen.getByText("Using your photo")).toBeInTheDocument();
    expect(
      screen.getByText("The photo added in the chat will be the cover, so research did not look for another.")
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(choice()).toEqual({ choice: "none" });
  });

  it("says none was found when research found nothing, with no frame", () => {
    render(<Harness images={{ candidates: [], cleaned: null }} />);

    expect(screen.getByText("No product image was found")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="image-frame"]')).toBeNull();
    expect(choice()).toEqual({ choice: "none" });
  });

  it("says why in one line when the stage failed", () => {
    render(<Harness images={null} imageError="the ranking model was not available (MODEL_IMAGE_RANK)" />);

    expect(
      screen.getByText("No product image was found: the ranking model was not available (MODEL_IMAGE_RANK)")
    ).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("renders nothing for research from before the image stage", () => {
    const { container } = render(<Harness images={undefined} />);
    expect(container.querySelector('[data-slot="product-image"]')).toBeNull();
  });
});

describe("initialImageChoice", () => {
  it("prefers the cleaned copy, then rank 1, then none — and none whenever there is an uploaded photo", () => {
    expect(initialImageChoice(THREE, false)).toEqual({ choice: "cleaned" });
    expect(initialImageChoice({ ...THREE, cleaned: null }, false)).toEqual({
      choice: "original",
      candidateUrl: "https://cdn.prusa3d.com/img/mk4s-1.png",
    });
    expect(initialImageChoice({ candidates: [], cleaned: null }, false)).toEqual({ choice: "none" });
    expect(initialImageChoice(null, false)).toEqual({ choice: "none" });
    expect(initialImageChoice(undefined, false)).toEqual({ choice: "none" });
    expect(initialImageChoice(THREE, true)).toEqual({ choice: "none" });
  });
});

describe('ProductImage — view tags (amendment "front-facing images")', () => {
  it("tags a back view, a detail and a part, and nothing else", () => {
    render(
      <Harness
        images={{
          candidates: [candidate(1, { view: "front" }), candidate(2, { view: "detail", url: "https://cdn.prusa3d.com/img/d.png" }), candidate(3, { view: "back", url: "https://cdn.prusa3d.com/img/b.png" })],
          cleaned: null,
        }}
      />
    );
    expect(screen.getByText("Detail")).toBeInTheDocument();
    expect(screen.getByText("Back view")).toBeInTheDocument();
    expect(screen.queryByText("Part")).not.toBeInTheDocument();
    expect(screen.queryByText(/front/i)).not.toBeInTheDocument();
  });

  it("offers no Find a different image without the action", () => {
    render(<Harness />);
    expect(screen.queryByRole("button", { name: "Find a different image" })).not.toBeInTheDocument();
  });
});
