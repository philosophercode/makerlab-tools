import { render, screen, userEvent } from "../../test/utils/render";
import { IdentificationCard } from "./IdentificationCard";
import type {
  IdentificationCardPayload,
  IntakeEvidence,
} from "../lib/capabilities/types";

/**
 * Component coverage for the confidence strip (confidence spec §6): the basis,
 * the named unknowns, and the sources the agent actually read.
 */

function evidence(over: Partial<IntakeEvidence> = {}): IntakeEvidence {
  return {
    userStatedModel: false,
    modelPlateRead: null,
    manufacturerPageFound: false,
    manualFound: false,
    specsFromSource: false,
    categoryOnly: false,
    ...over,
  };
}

function card(over: Partial<IdentificationCardPayload> = {}): IdentificationCardPayload {
  return {
    kind: "identification",
    candidateId: "bambu-lab-x1-carbon",
    state: "proposed",
    name: "Bambu Lab X1-Carbon",
    photoUrls: [],
    specLines: [],
    foundResources: [],
    alsoCreating: [],
    actions: [],
    ...over,
  };
}

const noop = () => {};

describe("confidence strip", () => {
  it("leads with the level for a well-evidenced proposal", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "high", basis: [], unknowns: [] },
          evidence: evidence({
            modelPlateRead: "X1-Carbon",
            manufacturerPageFound: true,
            manualFound: true,
            specsFromSource: true,
          }),
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("Model plate reads “X1-Carbon”")).toBeInTheDocument();
    expect(screen.getByText("Manual found")).toBeInTheDocument();
  });

  it("names the specific unknown rather than a number", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ specsFromSource: true }),
        })}
        onAction={noop}
      />
    );
    expect(
      screen.getByText(
        "The model number couldn’t be read — a photo of the label would settle it"
      )
    ).toBeInTheDocument();
    expect(
      screen.getByText("No manufacturer page or manual was found to check against")
    ).toBeInTheDocument();
  });

  it("still shows the strip on a card that records a completed write", () => {
    // A low grade suppresses a *proposal*; it must not hide the record of a
    // write that already happened.
    render(
      <IdentificationCard
        card={card({
          state: "success",
          confidence: { level: "low", basis: [], unknowns: [] },
          evidence: evidence({ categoryOnly: true }),
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(
      screen.getByText("Only the general type of equipment could be identified")
    ).toBeInTheDocument();
  });

  it("labels a medium proposal as needing confirmation", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true }),
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText("Needs confirmation")).toBeInTheDocument();
    expect(screen.getByText("You gave the make and model")).toBeInTheDocument();
    expect(
      screen.getByText("No manufacturer page or manual was found to check against")
    ).toBeInTheDocument();
  });

  it("marks held evidence solid and unknowns hollow — no traffic lights", () => {
    const { container } = render(
      <IdentificationCard
        card={card({
          confidence: { level: "high", basis: [], unknowns: [] },
          evidence: evidence({
            userStatedModel: true,
            manufacturerPageFound: true,
          }),
        })}
        onAction={noop}
      />
    );
    const markers = container.querySelectorAll(
      ".id-card-confidence-marker circle"
    );
    expect(markers.length).toBeGreaterThan(1);
    expect(markers[0].getAttribute("fill")).toBe("currentColor");
    expect(markers[markers.length - 1].getAttribute("fill")).toBe("none");
    // Screen readers get the same distinction the marker shape carries.
    expect(screen.getAllByText("Confirmed").length).toBe(2);
    expect(screen.getAllByText("Unknown").length).toBeGreaterThan(0);
  });

  it("renders sources as safe external links", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "high", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true, manualFound: true }),
          sourceUrls: [
            "https://www.bambulab.com/en/x1",
            "http://store.bambulab.com/item",
          ],
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText(/Sources/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: "bambulab.com" });
    expect(link).toHaveAttribute("href", "https://www.bambulab.com/en/x1");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("target", "_blank");
    expect(
      screen.getByRole("link", { name: "store.bambulab.com" })
    ).toBeInTheDocument();
  });

  it("drops any source URL that is not http(s)", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true }),
          sourceUrls: ["javascript:alert(1)", "data:text/html,<b>x</b>", "nope"],
        })}
        onAction={noop}
      />
    );
    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument();
    expect(screen.queryAllByRole("link")).toHaveLength(0);
  });

  it("renders no strip when the card carries no confidence", () => {
    const { container } = render(
      <IdentificationCard card={card()} onAction={noop} />
    );
    expect(container.querySelector(".id-card-confidence")).toBeNull();
    expect(screen.getByText("Bambu Lab X1-Carbon")).toBeInTheDocument();
  });
});

/**
 * Behaviour gating (confidence spec §3.2). A grade that does not change the
 * interaction is decoration, so each level has to produce a visibly different
 * card — and the low one has to produce no card at all.
 */
describe("confidence gating", () => {
  it("renders NO card for a low-confidence proposal", () => {
    // The server withholds these too; this is the second half of the same rule.
    // A proposal the evidence cannot support must never appear as a
    // plausible-looking listing with an "add it" button next to it.
    const { container } = render(
      <IdentificationCard
        card={card({
          confidence: { level: "low", basis: [], unknowns: [] },
          evidence: evidence({ categoryOnly: true }),
          actions: [
            {
              id: "confirm",
              label: "Looks right — add it",
              labelKey: "actionConfirm",
              seedMessage: "confirm add: x",
              variant: "primary",
            },
          ],
        })}
        onAction={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText("Bambu Lab X1-Carbon")).not.toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("renders no card for a low-confidence duplicate match either", () => {
    const { container } = render(
      <IdentificationCard
        card={card({
          state: "duplicate",
          duplicateOf: { id: "page-1", name: "Bambu Lab X1-Carbon" },
          confidence: { level: "low", basis: [], unknowns: [] },
          evidence: evidence(),
        })}
        onAction={noop}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps rendering a high-confidence proposal unchanged", () => {
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "high", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true, manualFound: true }),
          actions: [
            {
              id: "confirm",
              label: "Looks right — add it",
              labelKey: "actionConfirm",
              seedMessage: "confirm add: x",
              variant: "primary",
            },
          ],
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText("Bambu Lab X1-Carbon")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Looks right — add it" })
    ).toBeInTheDocument();
  });

  it("leads a medium proposal with the ambiguity, above the listing", () => {
    const { container } = render(
      <IdentificationCard
        card={card({
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true }),
        })}
        onAction={noop}
      />
    );
    const text = container.textContent || "";
    expect(text.indexOf("Needs confirmation")).toBeGreaterThanOrEqual(0);
    // The unresolved question is read before the confident-looking name.
    expect(text.indexOf("Needs confirmation")).toBeLessThan(
      text.indexOf("Bambu Lab X1-Carbon")
    );
    expect(
      text.indexOf("No manufacturer page or manual was found to check against")
    ).toBeLessThan(text.indexOf("You gave the make and model"));
  });

  it("makes resolving the variant the primary action at medium", async () => {
    const seen: string[] = [];
    render(
      <IdentificationCard
        card={card({
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true }),
          actions: [
            {
              id: "variant-0",
              label: "It's the Prusa MK4",
              labelKey: "actionConfirmVariant",
              labelValues: { variant: "Prusa MK4" },
              seedMessage: "confirm variant: prusa-mk4 = Prusa MK4",
              variant: "primary",
            },
            {
              id: "variant-1",
              label: "It's the Prusa MK4S",
              labelKey: "actionConfirmVariant",
              labelValues: { variant: "Prusa MK4S" },
              seedMessage: "confirm variant: prusa-mk4 = Prusa MK4S",
              variant: "primary",
            },
          ],
        })}
        onAction={(seed) => seen.push(seed)}
      />
    );
    // Localized from the key with its values — a placeholder with no param
    // would render literally, which is the bug this asserts against.
    expect(
      screen.getByRole("button", { name: "It’s the Prusa MK4" })
    ).toBeInTheDocument();
    const mk4s = screen.getByRole("button", { name: "It’s the Prusa MK4S" });
    expect(screen.queryByText(/\{variant\}/)).not.toBeInTheDocument();

    await userEvent.click(mk4s);
    expect(seen).toEqual(["confirm variant: prusa-mk4 = Prusa MK4S"]);
  });

  it("falls back to the English label when no key is supplied", () => {
    render(
      <IdentificationCard
        card={card({
          actions: [
            {
              id: "open-draft",
              label: "Open draft in Notion",
              seedMessage: "https://notion.so/x",
              variant: "secondary",
            },
          ],
        })}
        onAction={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: "Open draft in Notion" })
    ).toBeInTheDocument();
  });
});
