import { render, screen, userEvent, waitFor } from "../../../test/utils/render";
import type { PhotoOption, PhotoSearchView } from "../../lib/photo-options/types";
import { PhotoOptions, type PhotoOptionsProps } from "./PhotoOptions";

/**
 * **Photo options** in the tool editor's Photos section (photo options spec
 * 2026-10-29 §5): closed until asked, the latest search shown on open, tiles
 * with their tags, a pick that sends exactly the choice, and the running state.
 */

const TOOL = "7b2f0c3e-0d7b-4c55-9f2a-1b8e7d3c4a01";

function option(n: number, over: Partial<PhotoOption> = {}): PhotoOption {
  return {
    url: `https://www.prusa3d.com/img/mk4s-${n}.png`,
    pageUrl: "https://www.prusa3d.com/product/mk4s/",
    source: "og",
    width: 1200,
    height: 900,
    contentType: "image/png",
    reason: `reason ${n}`,
    ...over,
  };
}

function search(over: Partial<PhotoSearchView> = {}): PhotoSearchView {
  return {
    id: "s1",
    status: "ready",
    running: false,
    note: null,
    options: [option(1, { manufacturer: true, background: "plain" }), option(2, { composite: true, view: "back", pageUrl: "https://shop.example/p" })],
    error: null,
    chosenUrl: null,
    requestedAt: new Date().toISOString(),
    ...over,
  };
}

function props(over: Partial<PhotoOptionsProps> = {}): PhotoOptionsProps {
  return {
    toolId: TOOL,
    name: "Prusa MK4S",
    hasCover: true,
    pending: false,
    load: vi.fn(async () => ({ ok: true as const, search: null })),
    onFind: vi.fn(async () => ({ ok: true as const, searchId: "s2" })),
    onPick: vi.fn(async () => true),
    ...over,
  };
}

describe("PhotoOptions", () => {
  it("is one line and a button until asked, for a tool with no search", async () => {
    render(<PhotoOptions {...props()} />);
    expect(await screen.findByRole("button", { name: "Find photo options" })).toBeInTheDocument();
    expect(screen.getByText(/Wrong machine, a busy background/)).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("shows a ready search's tiles with their tags and where they are from", async () => {
    render(<PhotoOptions {...props({ load: vi.fn(async () => ({ ok: true as const, search: search() })) })} />);
    expect(await screen.findByRole("radio", { name: "Option 1" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Option 2" })).toBeInTheDocument();
    expect(screen.getByText("Manufacturer")).toBeInTheDocument();
    expect(screen.getByText("Plain background")).toBeInTheDocument();
    expect(screen.getByText("Banner")).toBeInTheDocument();
    expect(screen.getByText("Back view")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "From shop.example" })).toHaveAttribute("href", "https://shop.example/p");
    expect(screen.getByText("2 options found. Pick one to use it as the cover.")).toBeInTheDocument();
  });

  it("sends the picked option with both checkboxes as set", async () => {
    const onPick = vi.fn(async () => true);
    render(<PhotoOptions {...props({ onPick, load: vi.fn(async () => ({ ok: true as const, search: search() })) })} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Option 2" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Replace the current cover" }));
    await userEvent.click(screen.getByRole("button", { name: "Use as cover" }));

    expect(onPick).toHaveBeenCalledWith({ searchId: "s1", url: option(2).url, removeBackground: true, replaceCover: false });
  });

  it("offers no replace checkbox for a tool with no cover", async () => {
    const onPick = vi.fn(async () => true);
    render(<PhotoOptions {...props({ hasCover: false, onPick, load: vi.fn(async () => ({ ok: true as const, search: search() })) })} />);
    await userEvent.click(await screen.findByRole("radio", { name: "Option 1" }));
    expect(screen.queryByRole("checkbox", { name: "Replace the current cover" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Use as cover" }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ replaceCover: false }));
  });

  it("starts a search with the note and then shows it running", async () => {
    const load = vi
      .fn<PhotoOptionsProps["load"]>()
      .mockResolvedValueOnce({ ok: true, search: null })
      .mockResolvedValue({ ok: true, search: search({ status: "searching", running: true, options: [] }) });
    const onFind = vi.fn(async () => ({ ok: true as const, searchId: "s2" }));
    render(<PhotoOptions {...props({ load, onFind })} />);

    await userEvent.click(await screen.findByRole("button", { name: "Find photo options" }));
    await userEvent.type(screen.getByLabelText("Note for the search (optional)"), "the white one");
    await userEvent.click(screen.getByRole("button", { name: "Find photo options" }));

    expect(onFind).toHaveBeenCalledWith("the white one");
    expect(await screen.findByText(/Looking for photos/)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Find more options" })).toBeDisabled());
  });

  it("says why a search could not start", async () => {
    const onFind = vi.fn(async () => ({ ok: false as const, error: "daily_limit" as const }));
    render(<PhotoOptions {...props({ onFind })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Find photo options" }));
    await userEvent.click(screen.getByRole("button", { name: "Find photo options" }));
    expect(await screen.findByText(/today's research limit/)).toBeInTheDocument();
  });

  it("says what a failed search found", async () => {
    render(
      <PhotoOptions
        {...props({ load: vi.fn(async () => ({ ok: true as const, search: search({ status: "failed", options: [], error: "No new picture of it was found." }) })) })}
      />
    );
    await userEvent.click(await screen.findByRole("button", { name: "Find photo options" }));
    expect(screen.getByText("The search found nothing to offer: No new picture of it was found.")).toBeInTheDocument();
  });
});
