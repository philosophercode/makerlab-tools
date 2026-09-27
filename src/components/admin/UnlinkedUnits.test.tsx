import { render, screen } from "../../../test/utils/render";
import { UnlinkedUnits } from "./UnlinkedUnits";
import type { UnlinkedUnit } from "../../lib/data/inventory";

/**
 * The units nobody can find.
 *
 * The behaviour worth pinning is the one that keeps the page quiet: on a
 * workspace where every unit has a tool, this renders nothing at all.
 */

function unit(overrides: Partial<UnlinkedUnit> = {}): UnlinkedUnit {
  return {
    id: "u-1",
    unitLabel: "Mystery vinyl cutter",
    serialNumber: null,
    assetTag: null,
    status: "available",
    ...overrides,
  };
}

describe("UnlinkedUnits", () => {
  it("names each unit and how it is identified", () => {
    render(<UnlinkedUnits units={[unit({ serialNumber: "SN-9" })]} />);

    expect(screen.getByText("Mystery vinyl cutter")).toBeInTheDocument();
    expect(screen.getByText("Serial SN-9")).toBeInTheDocument();
  });

  it("falls back to the asset tag, then says there is neither", () => {
    render(
      <UnlinkedUnits
        units={[
          unit({ id: "u-1", assetTag: "CT-91" }),
          unit({ id: "u-2", unitLabel: "Unlabelled press" }),
        ]}
      />
    );

    expect(screen.getByText("Asset tag CT-91")).toBeInTheDocument();
    expect(screen.getByText("No serial or asset tag recorded")).toBeInTheDocument();
  });

  it("renders nothing when every unit has a tool", () => {
    const { container } = render(<UnlinkedUnits units={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
