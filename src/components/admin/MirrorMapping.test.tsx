import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { MirrorActionResult, MirrorCreateResult } from "../../app/admin/mirror/action-result";
import { MirrorMapping, type MirrorMappingActions } from "./MirrorMapping";

/**
 * The mapping panel (spec §3.8 "Mapping", §5.8, Article 4).
 *
 * The seven tables in push order, each with its database or "Not set"; Create
 * databases saying what it made — including when it stopped part-way, which
 * still made some; and a pasted mapping whose problems land under the table
 * they concern, naming the properties.
 */

const TOOLS_DB = "1a2b3c4d-0000-4000-8000-000000000001";

function actions(over: Partial<MirrorMappingActions> = {}): MirrorMappingActions {
  return {
    createDatabases: vi.fn(
      async (): Promise<MirrorCreateResult> => ({
        ok: true,
        created: ["categories", "locations", "units", "resources", "maintenance", "projects"],
        kept: ["tools"],
      })
    ),
    saveMapping: vi.fn(async (): Promise<MirrorActionResult> => ({ ok: true })),
    ...over,
  };
}

function rows() {
  const table = screen.getByRole("table", { name: "Notion databases, one per table" });
  return within(table).getAllByRole("row").slice(1);
}

describe("MirrorMapping", () => {
  it("lists the seven tables in push order, each with its database or Not set", () => {
    render(<MirrorMapping mapping={{ tools: TOOLS_DB }} editable actions={actions()} />);

    const listed = rows();
    expect(listed.map((row) => within(row).getByRole("rowheader").textContent)).toEqual([
      "Categories",
      "Locations",
      "Tools",
      "Units",
      "Resources",
      "Maintenance",
      "Projects",
    ]);
    expect(within(listed[2]).getByText(TOOLS_DB)).toBeInTheDocument();
    expect(within(listed[0]).getByText("Not set")).toBeInTheDocument();
    expect(screen.getAllByText("Not set")).toHaveLength(6);
  });

  it("creates the databases and says how many it made", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorMapping mapping={{ tools: TOOLS_DB }} editable actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Create databases" }));

    expect(bundle.createDatabases).toHaveBeenCalledTimes(1);
    expect(await screen.findByText("Created 6 databases.")).toBeInTheDocument();
  });

  it("says when every database already existed", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      createDatabases: vi.fn(async (): Promise<MirrorCreateResult> => ({ ok: true, created: [], kept: ["tools"] })),
    });
    render(<MirrorMapping mapping={{ tools: TOOLS_DB }} editable actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Create databases" }));
    expect(await screen.findByText(/Every database already exists/)).toBeInTheDocument();
  });

  it("names what it made before a create stopped part-way, and where it stopped", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      createDatabases: vi.fn(
        async (): Promise<MirrorCreateResult> => ({
          ok: false,
          error: "notion_unavailable",
          created: ["categories", "locations"],
          entity: "tools",
        })
      ),
    });
    render(<MirrorMapping mapping={{}} editable actions={bundle} />);

    await user.click(screen.getByRole("button", { name: "Create databases" }));

    const line = await screen.findByText(/Notion did not answer/);
    expect(line).toHaveTextContent("It stopped at Tools.");
    expect(line).toHaveTextContent("Created 2 databases before stopping: Categories and Locations.");
    expect(line).toHaveClass("is-warning");
  });

  it("saves pasted ids, sending only the tables that were filled", async () => {
    const user = userEvent.setup();
    const bundle = actions();
    render(<MirrorMapping mapping={{}} editable actions={bundle} />);

    await user.click(screen.getByText("Use databases you already have"));
    await user.type(screen.getByLabelText("Tools database"), `  https://www.notion.so/acme/${TOOLS_DB.replace(/-/g, "")}  `);
    await user.click(screen.getByRole("button", { name: "Save mapping" }));

    expect(bundle.saveMapping).toHaveBeenCalledWith({
      tools: `https://www.notion.so/acme/${TOOLS_DB.replace(/-/g, "")}`,
    });
    expect(await screen.findByText("Saved. Every pasted database matches.")).toBeInTheDocument();
  });

  it("puts each problem under the table it concerns, naming the properties", async () => {
    const user = userEvent.setup();
    const bundle = actions({
      saveMapping: vi.fn(
        async (): Promise<MirrorActionResult> => ({
          ok: false,
          error: "schema_mismatch",
          problems: [
            { entity: "tools", code: "schema_mismatch", missing: ["Published", "Slug"], wrongType: ["Category"] },
            { entity: "units", code: "database_not_found" },
          ],
        })
      ),
    });
    render(<MirrorMapping mapping={{}} editable actions={bundle} />);

    await user.click(screen.getByText("Use databases you already have"));
    await user.type(screen.getByLabelText("Tools database"), TOOLS_DB);
    await user.type(screen.getByLabelText("Units database"), "0f5e4a3c111122223333444455556666");
    await user.click(screen.getByRole("button", { name: "Save mapping" }));

    expect(await screen.findByText(/do not match what the mirror writes/)).toBeInTheDocument();
    const tools = screen.getByLabelText("Tools database");
    expect(tools).toHaveAttribute("aria-invalid", "true");
    expect(tools).toHaveAccessibleDescription(/Missing: Published and Slug/);
    expect(tools).toHaveAccessibleDescription(/Wrong type: Category/);
    expect(screen.getByLabelText("Units database")).toHaveAccessibleDescription(/Not found/);
    expect(screen.getByLabelText("Categories database")).not.toHaveAttribute("aria-invalid");
    expect(screen.queryByText(/^Saved/)).not.toBeInTheDocument();
  });

  it("shows the mapping but offers no changes without a working token", () => {
    render(<MirrorMapping mapping={{ tools: TOOLS_DB }} editable={false} actions={actions()} />);

    expect(screen.getByText(TOOLS_DB)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create databases" })).not.toBeInTheDocument();
    expect(screen.queryByText("Use databases you already have")).not.toBeInTheDocument();
    expect(screen.getByText(/Connect again to change the databases/)).toBeInTheDocument();
  });
});
