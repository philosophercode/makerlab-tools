import { render, screen, within } from "../../test/utils/render";
import { UnitsList } from "./UnitsList";
import {
  availableUnit,
  inUseUnit,
  offlineUnit,
} from "../../test/fixtures/catalog";
import type { MakerLabUnit } from "./catalog-types";

describe("UnitsList", () => {
  it("renders the panel headings", () => {
    render(<UnitsList units={[availableUnit]} />);
    expect(screen.getByText("LINKED UNITS")).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Physical Machines" })
    ).toBeInTheDocument();
  });

  it("renders a row per unit with name, location, serial, status, and condition", () => {
    const units: MakerLabUnit[] = [availableUnit, inUseUnit, offlineUnit];
    render(<UnitsList units={units} />);

    for (const unit of units) {
      // name is an <h3>
      expect(
        screen.getByRole("heading", { name: unit.name })
      ).toBeInTheDocument();
      // location, serial, condition appear as text
      expect(screen.getByText(unit.serial)).toBeInTheDocument();
    }

    // location can repeat across units, so just confirm each is present at least once
    expect(screen.getByText(availableUnit.location)).toBeInTheDocument();
    expect(screen.getByText(inUseUnit.location)).toBeInTheDocument();
    expect(screen.getByText(offlineUnit.location)).toBeInTheDocument();
  });

  it("scopes status/serial/condition values to the correct unit row", () => {
    render(<UnitsList units={[availableUnit]} />);

    const heading = screen.getByRole("heading", { name: availableUnit.name });
    const row = heading.closest("article.unit-row") as HTMLElement;
    expect(row).not.toBeNull();

    const scoped = within(row);
    expect(scoped.getByText("Status")).toBeInTheDocument();
    expect(scoped.getByText(availableUnit.status)).toBeInTheDocument();
    expect(scoped.getByText("Serial")).toBeInTheDocument();
    expect(scoped.getByText(availableUnit.serial)).toBeInTheDocument();
    expect(scoped.getByText("Condition")).toBeInTheDocument();
    expect(scoped.getByText(availableUnit.condition)).toBeInTheDocument();
  });

  it("uses the live-dot status indicator only for In Use units", () => {
    const { container } = render(<UnitsList units={[inUseUnit]} />);
    // In Use -> live-dot
    expect(container.querySelector(".live-dot")).not.toBeNull();
    expect(container.querySelector(".status-square")).toBeNull();
  });

  it("uses the status-square indicator for non-In-Use units", () => {
    const { container } = render(<UnitsList units={[availableUnit]} />);
    // Available -> status-square
    expect(container.querySelector(".status-square")).not.toBeNull();
    expect(container.querySelector(".live-dot")).toBeNull();
  });

  it("reflects each unit's status text from the data", () => {
    render(<UnitsList units={[availableUnit, inUseUnit, offlineUnit]} />);
    expect(screen.getByText("Available")).toBeInTheDocument();
    expect(screen.getByText("In Use")).toBeInTheDocument();
    // "Offline" is both a status and the offline unit's condition -> 2 matches
    expect(screen.getAllByText("Offline")).toHaveLength(2);
  });

  it("renders condition values from the data", () => {
    render(<UnitsList units={[availableUnit, inUseUnit]} />);
    expect(screen.getByText("Excellent")).toBeInTheDocument();
    expect(screen.getByText("Good")).toBeInTheDocument();
  });

  it("renders nothing in the list when given an empty units array", () => {
    const { container } = render(<UnitsList units={[]} />);
    // Headings still render, but no unit rows exist.
    expect(container.querySelectorAll("article.unit-row")).toHaveLength(0);
    expect(
      screen.getByRole("heading", { name: "Physical Machines" })
    ).toBeInTheDocument();
  });
});
