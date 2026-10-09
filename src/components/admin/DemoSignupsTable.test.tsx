import { render, screen, within } from "../../../test/utils/render";
import { DemoSignupsTable, type DemoSignupRow } from "./DemoSignupsTable";

/** People → Demo sign-ups (demo pass spec 2026-10-07 §5.6). */

const ROW: DemoSignupRow = {
  id: "s-1",
  name: "Ada Lovelace",
  email: "ada@example.org",
  institution: "Analytical Engines Lab",
  role: "lab_manager",
  runsMakerspace: true,
  useCase: "Inducting new members",
  consentToContact: true,
  passActive: true,
  passEndsOn: "2026-10-25",
  spentUsd: 0.1234,
  chargedTurns: 9,
  signedUpOn: "2026-10-11",
};

describe("DemoSignupsTable", () => {
  it("shows each sign-up's answers, consent, pass and spend", () => {
    render(<DemoSignupsTable rows={[ROW, { ...ROW, id: "s-2", name: "Grace Hopper", email: "grace@example.org", role: null, runsMakerspace: null, consentToContact: false, passActive: false }]} budgetUsd={0.5} />);
    const table = screen.getByRole("table", { name: "Demo sign-ups" });
    const ada = within(table).getByRole("row", { name: /Ada Lovelace/ });
    expect(ada).toHaveTextContent("ada@example.org");
    expect(ada).toHaveTextContent("Lab director or manager");
    expect(ada).toHaveTextContent("Until 2026-10-25");
    expect(ada).toHaveTextContent("$0.12 of $0.50");
    expect(ada).toHaveTextContent("9 turns");
    expect(within(ada).getByRole("link", { name: "ada@example.org" })).toHaveAttribute("href", "mailto:ada@example.org");
    const grace = within(table).getByRole("row", { name: /Grace Hopper/ });
    expect(grace).toHaveTextContent("Ended");
  });

  it("says plainly when nobody has signed up", () => {
    render(<DemoSignupsTable rows={[]} budgetUsd={0.5} />);
    expect(screen.getByText("Nobody has signed up for a demo pass yet. The form is at /demo.")).toBeInTheDocument();
  });
});
