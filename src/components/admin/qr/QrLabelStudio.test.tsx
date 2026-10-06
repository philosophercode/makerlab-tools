vi.mock("./label-files", () => ({
  buildPdf: vi.fn(async () => new Uint8Array([37, 80, 68, 70])),
  printPdf: vi.fn(),
  savePdf: vi.fn(),
  saveBlob: vi.fn(),
  labelSvgFile: vi.fn(async () => new Blob(["<svg/>"])),
  labelPngFile: vi.fn(async () => new Blob(["png"])),
  loadMeasure: vi.fn(() => new Promise(() => {})),
}));

import { render, screen, userEvent, waitFor, within } from "../../../../test/utils/render";
import { SETTINGS_STORAGE_KEY } from "../../../lib/qr/settings";
import { buildPdf, printPdf, savePdf } from "./label-files";
import { QrLabelStudio, type QrLabelRow } from "./QrLabelStudio";

/**
 * `/admin/inventory/qr`'s island (QR labels): the list with its selection,
 * the live preview and the print actions, and the styler's settings
 * remembered per browser.
 */

const rows: QrLabelRow[] = [
  { id: "1", slug: "form-4", name: "Form 4", category: "3D Printers", room: "Main Lab", zone: "Resin Bench" },
  { id: "2", slug: "trotec-speedy-400", name: "Trotec Speedy 400", category: "Laser Cutters", room: "Laser Room", zone: "Laser Bay" },
  {
    id: "3",
    slug: "prusa-mk4",
    name: "Prusa MK4",
    category: "3D Printers",
    room: "Main Lab",
    zone: null,
    units: [
      { id: "adf75899-7fc0-49e2-bfef-d6af0be787f5", name: "Prusa #1" },
      { id: "194e4406-253b-4488-a886-5598ee56112c", name: "Prusa #2" },
    ],
  },
];

const origin = "https://makerlab-ai.vercel.app";

beforeEach(() => {
  try {
    window.localStorage.clear();
  } catch {
    // no storage in this environment
  }
  vi.mocked(buildPdf).mockClear();
  vi.mocked(printPdf).mockClear();
  vi.mocked(savePdf).mockClear();
});

function setup() {
  const user = userEvent.setup();
  render(<QrLabelStudio rows={rows} origin={origin} wordmarkHref="/makerlab-wordmark.png" />);
  return user;
}

describe("QrLabelStudio", () => {
  it("previews the first tool's label with the ?src=qr address, at the chosen size", () => {
    setup();
    const preview = screen.getByRole("img", { name: "Label preview for Form 4" });
    expect(preview).toHaveAttribute("data-qr-preview", "https://makerlab-ai.vercel.app/tools/form-4?src=qr");
    expect(preview.getAttribute("viewBox")).toBe("0 0 50.8 50.8");
    expect(screen.getByText("12 labels per US Letter page (3 × 4).")).toBeInTheDocument();
  });

  it("previews the tool a row asks for", async () => {
    const user = setup();
    const table = screen.getByRole("table", { name: "Published tools to print labels for" });
    const row = within(table).getByRole("rowheader", { name: "Trotec Speedy 400" }).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Preview" }));
    expect(screen.getByRole("img", { name: "Label preview for Trotec Speedy 400" })).toBeInTheDocument();
  });

  it("prints the selected tools in one click", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Select all (3)" }));
    await user.click(screen.getAllByRole("button", { name: "Print selected (3)" })[0]);
    await waitFor(() => expect(printPdf).toHaveBeenCalledTimes(1));
    const [labels, settings] = vi.mocked(buildPdf).mock.calls[0];
    expect(labels.map((label) => label.url)).toEqual([
      "https://makerlab-ai.vercel.app/tools/form-4?src=qr",
      "https://makerlab-ai.vercel.app/tools/trotec-speedy-400?src=qr",
      "https://makerlab-ai.vercel.app/tools/prusa-mk4?src=qr",
    ]);
    expect(settings.sheet.paper).toBe("letter");
  });

  it("selects only what the filter shows with Select filtered", async () => {
    const user = setup();
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "Trotec");
    await user.click(screen.getByRole("button", { name: "Select filtered (1)" }));
    await user.click(screen.getAllByRole("button", { name: "Print selected (1)" })[0]);
    await waitFor(() => expect(printPdf).toHaveBeenCalled());
    expect(vi.mocked(buildPdf).mock.calls[0][0].map((label) => label.name)).toEqual(["Trotec Speedy 400"]);
  });

  it("prints all, prints one, and downloads the PDF", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Print all (3)" }));
    await waitFor(() => expect(printPdf).toHaveBeenCalledTimes(1));
    expect(vi.mocked(buildPdf).mock.calls[0][0]).toHaveLength(3);

    await user.click(screen.getByRole("button", { name: "Print this one" }));
    await waitFor(() => expect(printPdf).toHaveBeenCalledTimes(2));
    expect(vi.mocked(buildPdf).mock.calls[1][0].map((label) => label.name)).toEqual(["Form 4"]);

    await user.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(savePdf).toHaveBeenCalledWith(expect.any(Uint8Array), "qr-labels.pdf"));
  });

  it("changes the size, recounts the page and remembers the choice", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "1 inch square" }));
    expect(screen.getByText("48 labels per US Letter page (6 × 8).")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Label preview for Form 4" }).getAttribute("viewBox")).toBe("0 0 25.4 25.4");
    expect(screen.getByText(/The code is .* mm\. Under 25 mm/)).toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem(SETTINGS_STORAGE_KEY)!).preset).toBe("1in");
    // The 1-inch default: the code gets the room, and either can go back on.
    expect(screen.getByRole("checkbox", { name: "MakerLAB wordmark" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Extra line" })).not.toBeChecked();
    await user.click(screen.getByRole("checkbox", { name: "MakerLAB wordmark" }));
    expect(screen.getByRole("checkbox", { name: "MakerLAB wordmark" })).toBeChecked();
  });

  // Unit labels (QR codes spec amendment 2026-10-06): one label per machine.
  it("lists every unit and previews a unit's label with the unit's code", async () => {
    const user = setup();
    expect(screen.getByRole("button", { name: "Tools (3)" })).toHaveAttribute("aria-pressed", "true");
    await user.click(screen.getByRole("button", { name: "Units (2)" }));

    const table = screen.getByRole("table", { name: "Units of published tools to print labels for" });
    expect(within(table).getByRole("rowheader", { name: "Prusa #1" })).toBeInTheDocument();
    expect(within(table).getByRole("rowheader", { name: "Prusa #2" })).toBeInTheDocument();
    expect(within(table).queryByRole("rowheader", { name: "Form 4" })).not.toBeInTheDocument();

    const preview = screen.getByRole("img", { name: "Label preview for Prusa #1" });
    expect(preview).toHaveAttribute("data-qr-preview", "https://makerlab-ai.vercel.app/tools/prusa-mk4?src=qr&unit=adf75899");
    // The unit's row links to the page its code opens.
    expect(within(table).getByRole("link", { name: "Prusa #2" })).toHaveAttribute("href", "/tools/prusa-mk4?unit=194e4406");
  });

  it("prints unit labels: the tool's name, the unit's line and the unit's address", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Units (2)" }));
    await user.click(screen.getByRole("button", { name: "Print all (2)" }));
    await waitFor(() => expect(printPdf).toHaveBeenCalledTimes(1));
    const [labels] = vi.mocked(buildPdf).mock.calls[0];
    expect(labels.map((label) => [label.name, label.unit, label.url])).toEqual([
      ["Prusa MK4", "Prusa #1", "https://makerlab-ai.vercel.app/tools/prusa-mk4?src=qr&unit=adf75899"],
      ["Prusa MK4", "Prusa #2", "https://makerlab-ai.vercel.app/tools/prusa-mk4?src=qr&unit=194e4406"],
    ]);
  });

  it("finds units by their tool's name, and starts the selection over when the list changes", async () => {
    const user = setup();
    await user.click(screen.getByRole("button", { name: "Select all (3)" }));
    await user.click(screen.getByRole("button", { name: "Units (2)" }));
    expect(screen.getAllByRole("button", { name: "Print selected (0)" })[0]).toBeDisabled();
    await user.type(screen.getByRole("searchbox", { name: "Search tools" }), "Prusa MK4");
    expect(screen.getByRole("button", { name: "Select filtered (2)" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Tools (3)" }));
    expect(screen.getByRole("table", { name: "Published tools to print labels for" })).toBeInTheDocument();
  });

  it("says how to add units when no published tool has any", async () => {
    const user = userEvent.setup();
    render(<QrLabelStudio rows={rows.slice(0, 2)} origin={origin} wordmarkHref="/makerlab-wordmark.png" />);
    await user.click(screen.getByRole("button", { name: "Units (0)" }));
    expect(screen.getAllByText("No published tool has units listed yet. Add them in a tool's editor.").length).toBeGreaterThan(0);
  });

  it("switches the page to one label per page for a label printer", async () => {
    const user = setup();
    await user.selectOptions(screen.getByRole("combobox", { name: "Paper" }), "label");
    expect(screen.getByText("One label per page, at the label's own size.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Light cut guides" })).not.toBeInTheDocument();
  });
});
