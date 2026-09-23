import { render, screen, within } from "../../test/utils/render";
import type { IntakeEvidence } from "../lib/capabilities/types";
import { ConfidenceStrip } from "./ConfidenceStrip";

/**
 * The strip on its own (confidence spec §6, spec §5.4 step 10).
 *
 * `IdentificationCard.test.tsx` covers it inside the chat card; these cover the
 * props the preliminary page passes directly — a `ResearchResult`'s grade,
 * evidence and sources, with no card around them.
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

describe("ConfidenceStrip", () => {
  it("names the level and the evidence held", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "high", basis: [], unknowns: [] }}
        evidence={evidence({
          userStatedModel: true,
          manufacturerPageFound: true,
          manualFound: true,
        })}
      />
    );

    expect(screen.getByText("High confidence")).toBeInTheDocument();
    expect(screen.getByText("You gave the make and model")).toBeInTheDocument();
    expect(screen.getByText("Manual found")).toBeInTheDocument();
  });

  it("says what is unknown at low confidence, rather than a number", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "low", basis: [], unknowns: [] }}
        evidence={evidence({ categoryOnly: true })}
      />
    );

    expect(screen.getByText("Low confidence")).toBeInTheDocument();
    expect(
      screen.getByText("Only the general type of equipment could be identified")
    ).toBeInTheDocument();
  });

  it("leads with the unknowns when asked to", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "medium", basis: [], unknowns: [] }}
        evidence={evidence({ userStatedModel: true })}
        unknownsFirst
      />
    );

    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("No manufacturer page or manual was found");
    expect(items[items.length - 1]).toHaveTextContent("You gave the make and model");
  });

  it("links each web source by its host and drops anything that is not http(s)", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "high", basis: [], unknowns: [] }}
        evidence={evidence({ userStatedModel: true, manufacturerPageFound: true })}
        sourceUrls={["https://www.prusa3d.com/mk4s", "javascript:alert(1)"]}
      />
    );

    const link = screen.getByRole("link", { name: "prusa3d.com" });
    expect(link).toHaveAttribute("href", "https://www.prusa3d.com/mk4s");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(screen.getAllByRole("link")).toHaveLength(1);
  });

  it("renders no sources line when research read nothing", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "low", basis: [], unknowns: [] }}
        evidence={evidence()}
      />
    );
    expect(screen.queryByText(/Sources/)).not.toBeInTheDocument();
  });
  it("says why a research result that read only a video is not high, first", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "medium", basis: [], unknowns: [] }}
        evidence={evidence({ userStatedModel: true, manualFound: true })}
        sourceUrls={["https://www.youtube.com/watch?v=x2d"]}
        sourcesAreReads
        unknownsFirst
      />
    );
    const items = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(items[0]).toHaveTextContent("Only a video was read — no product page, manual or spec sheet");
  });

  it("says nothing could be read, instead of the no-source line", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "low", basis: [], unknowns: [] }}
        evidence={evidence()}
        sourceUrls={[]}
        sourcesAreReads
      />
    );
    expect(screen.getByText("No page could be read, so nothing was checked against a source")).toBeInTheDocument();
    expect(screen.queryByText(/No manufacturer page or manual was found/)).not.toBeInTheDocument();
  });

  it("adds neither line where the sources are not what research read (the chat card)", () => {
    render(
      <ConfidenceStrip
        confidence={{ level: "high", basis: [], unknowns: [] }}
        evidence={evidence({ userStatedModel: true, manualFound: true })}
        sourceUrls={["https://www.youtube.com/watch?v=x2d"]}
      />
    );
    expect(screen.queryByText(/Only a video was read/)).not.toBeInTheDocument();
  });
});
