import { render, screen } from "../../test/utils/render";
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
          confidence: { level: "low", basis: [], unknowns: [] },
          evidence: evidence({ categoryOnly: true }),
        })}
        onAction={noop}
      />
    );
    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The model number couldn’t be read — a photo of the label would settle it"
      )
    ).toBeInTheDocument();
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
          confidence: { level: "medium", basis: [], unknowns: [] },
          evidence: evidence({ userStatedModel: true }),
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
    expect(screen.getAllByText("Confirmed").length).toBe(1);
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
          confidence: { level: "low", basis: [], unknowns: [] },
          evidence: evidence(),
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
