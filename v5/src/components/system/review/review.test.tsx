import { useState } from "react";
import { render, screen, userEvent, within } from "../../../../test/utils/render";
import { Field, hintId } from "../Field";
import { DuplicateChoice } from "./DuplicateChoice";
import { ReviewCard, ReviewDiagnosis, ReviewNote, ReviewSources, ReviewValues } from "./ReviewCard";

/**
 * The review primitives (UI system spec §7.4; DESIGN.md §8.6): one decision
 * per card, named and outlined; before/after; quotes with a verified glyph and
 * the words when one was not found; the duplicate choice with radio
 * semantics that saves on a choice, never on an arrow key.
 */

describe("ReviewCard", () => {
  it("is a named article with its heading, marks and actions on one row", () => {
    render(
      <ReviewCard label="Use restrictions" tone="safety" marks={<span>SAFETY</span>} actions={<button type="button">Accept</button>}>
        <p>body</p>
      </ReviewCard>
    );
    const card = screen.getByRole("article", { name: "Use restrictions" });
    expect(within(card).getByRole("heading", { level: 4, name: "Use restrictions" })).toBeInTheDocument();
    expect(within(card).getByText("SAFETY")).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: "Accept" })).toBeInTheDocument();
    expect(card).toHaveAttribute("data-tone", "safety");
  });

  it("can be a region with a level-3 heading and a richer title", () => {
    render(<ReviewCard as="section" label="Another unit" headingLevel={3} title={<a href="/x">Another unit</a>} />);
    const region = screen.getByRole("region", { name: "Another unit" });
    expect(within(region).getByRole("heading", { level: 3 })).toContainElement(screen.getByRole("link", { name: "Another unit" }));
  });
});

describe("ReviewValues", () => {
  it("shows now and proposed, with what the proposal adds", () => {
    render(
      <ReviewValues
        before={{ label: "Now", content: "Acrylic" }}
        after={{ label: "Proposed", content: "Acrylic, Leather", note: "Adds: Leather" }}
      />
    );
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Acrylic")).toBeInTheDocument();
    expect(screen.getByText("Acrylic, Leather")).toBeInTheDocument();
    expect(screen.getByText("Adds: Leather")).toBeInTheDocument();
  });

  it("is all proposal when there is no record yet", () => {
    render(<ReviewValues after={{ label: "Proposed", content: "Form 4" }} />);
    expect(screen.queryByText("Now")).not.toBeInTheDocument();
    expect(screen.getByText("Form 4")).toBeInTheDocument();
  });
});

describe("ReviewSources", () => {
  it("marks a verified quote ● and one not found ■, struck, with the words", () => {
    render(
      <ReviewSources
        label="Sources"
        notFoundLabel="Quote not found on the page"
        items={[
          { quote: "found it", url: "https://a.example/p", host: "a.example", verified: true },
          { quote: "made it up", url: "https://b.example/p", host: "b.example", verified: false },
        ]}
      />
    );
    const [verified, missing] = screen.getAllByRole("listitem");
    expect(verified).toHaveAttribute("data-verified", "true");
    expect(within(verified).getByText("●")).toBeInTheDocument();
    expect(within(verified).queryByText("Quote not found on the page")).not.toBeInTheDocument();
    expect(missing).toHaveAttribute("data-verified", "false");
    expect(within(missing).getByText("■")).toBeInTheDocument();
    expect(within(missing).getByText("Quote not found on the page")).toBeInTheDocument();
    // Colour is never the only signal: the glyph's shape and the words say it.
    const link = within(missing).getByRole("link", { name: "b.example" });
    expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
    expect(link).toHaveAttribute("target", "_blank");
  });
});

describe("ReviewNote and ReviewDiagnosis", () => {
  it("is a live outcome line when asked", () => {
    render(
      <ReviewNote role="alert" tone="bad">
        That did not save.
      </ReviewNote>
    );
    expect(screen.getByRole("alert")).toHaveTextContent("That did not save.");
    expect(screen.getByRole("alert")).toHaveAttribute("data-tone", "bad");
  });

  it("labels a recorded diagnosis", () => {
    render(<ReviewDiagnosis label="What went wrong" lang="en">Model call timed out</ReviewDiagnosis>);
    expect(screen.getByText("What went wrong")).toBeInTheDocument();
    expect(screen.getByText("Model call timed out")).toHaveAttribute("lang", "en");
  });
});

describe("Field", () => {
  it("labels its control and describes it with the hint, and marks an update", () => {
    render(
      <Field id="f" label="Description" hint="Markdown is fine." updated>
        <textarea id="f" aria-describedby={hintId("f")} />
      </Field>
    );
    const box = screen.getByRole("textbox", { name: "Description" });
    expect(box).toHaveAccessibleDescription("Markdown is fine.");
    expect(box.closest('[data-slot="field"]')).toHaveAttribute("data-updated");
  });
});

describe("DuplicateChoice", () => {
  function Harness({ onChoose }: { onChoose: (value: string) => void }) {
    const [value, setValue] = useState<string | null>(null);
    return (
      <DuplicateChoice
        label="What to do with Form 4"
        match="Matches Form 4"
        matchId="m"
        options={[
          { value: "add_unit", label: "Another unit of it" },
          { value: "new_tool", label: "A different tool", ariaLabel: "Mark Form 4 as a different tool" },
          { value: "discard", label: "Remove" },
        ]}
        value={value}
        onChoose={(next) => {
          onChoose(next);
          setValue(next);
        }}
      />
    );
  }

  it("is a radio group described by the match, and a click chooses (and saves) once", async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    const group = screen.getByRole("radiogroup", { name: "What to do with Form 4" });
    expect(group).toHaveAccessibleDescription("Matches Form 4");
    const unit = within(group).getByRole("radio", { name: "Another unit of it" });
    expect(unit).not.toBeChecked();

    await userEvent.click(unit);
    expect(onChoose).toHaveBeenCalledWith("add_unit");
    expect(unit).toBeChecked();
    // Choosing what is already chosen sends nothing.
    await userEvent.click(unit);
    expect(onChoose).toHaveBeenCalledTimes(1);
    expect(within(group).getByRole("radio", { name: "Mark Form 4 as a different tool" })).not.toBeChecked();
  });

  it("never chooses on an arrow key — choosing saves, and Remove is one arrow away", async () => {
    const onChoose = vi.fn();
    render(<Harness onChoose={onChoose} />);
    screen.getByRole("radio", { name: "Mark Form 4 as a different tool" }).focus();
    await userEvent.keyboard("{ArrowRight}{ArrowDown}");
    expect(onChoose).not.toHaveBeenCalled();
    await userEvent.keyboard("{Enter}");
    expect(onChoose).toHaveBeenCalledWith("new_tool");
  });

  it("shows a decision that cannot be changed here as words, not controls", () => {
    render(
      <DuplicateChoice
        label="What to do with Form 4"
        match="Matches Form 4"
        options={[{ value: "new_tool", label: "A different tool" }]}
        value={null}
        onChoose={() => {}}
        resolved="Listing as a separate tool"
      />
    );
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    expect(screen.getByText("Listing as a separate tool")).toBeInTheDocument();
  });

  it("disables every choice while it cannot be made", () => {
    render(
      <DuplicateChoice
        label="What to do with Form 4"
        match="Matches Form 4"
        options={[{ value: "new_tool", label: "A different tool" }]}
        value={null}
        onChoose={() => {}}
        disabled
      />
    );
    expect(screen.getByRole("radio", { name: "A different tool" })).toBeDisabled();
  });
});
