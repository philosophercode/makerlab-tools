import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "../../../test/utils/render";
import { identityFor } from "../../../test/utils/identities";
import { toolWithLinks } from "../../../test/fixtures/catalog";
import type { Role } from "../../lib/auth/roles";
import type { MakerLabUnit } from "../catalog-types";

vi.mock("../../lib/auth/identity", () => ({ resolveIdentityFromHeaders: vi.fn() }));
vi.mock("../../lib/data/catalog", () => ({ listUnitSerials: vi.fn() }));

import { resolveIdentityFromHeaders } from "../../lib/auth/identity";
import { listUnitSerials } from "../../lib/data/catalog";
import { UnitsForViewer } from "./UnitsForViewer";

/**
 * The tool page's units table per viewer (data platform spec amendment
 * 2026-10-06): the page hands it the catalogue's units, which carry only each
 * serial's masked last four, and only staff get the whole serials added.
 */

const SERIAL = "ML-F4-001";
const SHORT_SERIAL = "9831";

/** The units as the catalogue sends them now: no serial field, only the masked last four. */
const [first] = toolWithLinks.units.map(({ serial: _serial, ...unit }) => unit);
const publicUnits: MakerLabUnit[] = [
  { ...first, serialMasked: "•••• -001" },
  // A serial of four characters or fewer: the catalogue sends nothing of it.
  { ...first, id: "unit-short-serial", name: "Form 4 #2" },
];

async function renderAs(role: Role) {
  vi.mocked(resolveIdentityFromHeaders).mockResolvedValue(identityFor(role));
  const element = await UnitsForViewer({ units: publicUnits });
  return render(element);
}

describe("UnitsForViewer", () => {
  beforeEach(() => {
    vi.mocked(resolveIdentityFromHeaders).mockReset();
    vi.mocked(listUnitSerials).mockReset();
    vi.mocked(listUnitSerials).mockResolvedValue(
      new Map([
        [publicUnits[0].id, SERIAL],
        [publicUnits[1].id, SHORT_SERIAL],
      ])
    );
  });

  it.each(["anonymous", "user"] as Role[])(
    "sends %s the serial column with only the last four, masked, and nothing of a short serial",
    async (role) => {
      const { container } = await renderAs(role);
      const table = within(screen.getByRole("table", { name: "Physical Machines" }));
      expect(table.getByText(publicUnits[0].name)).toBeInTheDocument();
      expect(table.getByRole("columnheader", { name: "Serial" })).toBeInTheDocument();
      // Seen as "•••• -001", heard as "Serial ending -001".
      const masked = table.getByText("•••• -001");
      expect(masked).toHaveAttribute("aria-hidden", "true");
      expect(table.getByText("Serial ending -001")).toHaveClass("sr-only");
      // The short serial's row shows a dash.
      const shortRow = within(table.getByRole("row", { name: /Form 4 #2/ }));
      expect(shortRow.getByText("–")).toBeInTheDocument();
      expect(container.textContent).not.toContain(SERIAL);
      expect(container.textContent).not.toContain(SHORT_SERIAL);
      // Not even read for them.
      expect(listUnitSerials).not.toHaveBeenCalled();
    }
  );

  it.each(["admin", "super_admin"] as Role[])("shows %s each unit's whole serial, short ones too", async (role) => {
    const { container } = await renderAs(role);
    const table = within(screen.getByRole("table", { name: "Physical Machines" }));
    expect(table.getByRole("columnheader", { name: "Serial" })).toBeInTheDocument();
    expect(table.getByText(SERIAL)).toBeInTheDocument();
    expect(table.getByText(SHORT_SERIAL)).toBeInTheDocument();
    expect(container.textContent).not.toContain("••••");
    expect(listUnitSerials).toHaveBeenCalledWith(publicUnits.map((unit) => unit.id));
  });
});
