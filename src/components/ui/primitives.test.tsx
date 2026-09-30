import Link from "next/link";
import { render, screen, userEvent } from "../../../test/utils/render";
import { Badge } from "./badge";
import { Button } from "./button";
import { Checkbox } from "./checkbox";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "./dropdown-menu";
import { Input } from "./input";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Separator } from "./separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "./table";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./tooltip";

/**
 * The shadcn primitives as themed for the Blueprint Archive (UI system spec
 * §7.1): what each renders, the behaviour Radix gives it, and the identity
 * rules the theme adds — one filled variant, labels not status, a visible
 * focus outline instead of a shadow ring.
 */

describe("Button", () => {
  it("is a quiet hairline button by default, and a filled accent only when asked", () => {
    render(
      <>
        <Button>Cancel</Button>
        <Button variant="default">Save</Button>
      </>
    );
    const cancel = screen.getByRole("button", { name: "Cancel" });
    expect(cancel).toHaveAttribute("data-variant", "quiet");
    expect(cancel).toHaveAttribute("data-slot", "button");
    expect(cancel.className).toContain("border-border");
    expect(cancel.className).not.toContain("bg-primary");

    const save = screen.getByRole("button", { name: "Save" });
    expect(save.className).toContain("bg-primary");
    // Near-black on orange (6.8:1), never white (2.8:1).
    expect(save.className).toContain("text-primary-foreground");
  });

  it("draws focus as an outline in the ring colour — the global no-shadow rule would erase a ring", () => {
    render(<Button>Go</Button>);
    const button = screen.getByRole("button", { name: "Go" });
    expect(button.className).toContain("focus-visible:outline-ring");
    expect(button.className).not.toMatch(/(^|\s)focus-visible:ring/);
  });

  it("styles its child instead of nesting a button in a link (asChild)", () => {
    render(
      <Button asChild variant="link">
        <Link href="/admin/inventory">Inventory</Link>
      </Button>
    );
    const link = screen.getByRole("link", { name: "Inventory" });
    expect(link).toHaveAttribute("href", "/admin/inventory");
    expect(link).toHaveAttribute("data-slot", "button");
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("does not fire when disabled", async () => {
    const onClick = vi.fn();
    render(
      <Button disabled onClick={onClick}>
        Refresh
      </Button>
    );
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onClick).not.toHaveBeenCalled();
  });

  it("lets a caller's class win a conflict", () => {
    render(
      <Button size="xs" className="h-10">
        Tall
      </Button>
    );
    const button = screen.getByRole("button", { name: "Tall" });
    expect(button.className).toContain("h-10");
    expect(button.className).not.toMatch(/(^|\s)h-6(\s|$)/);
  });
});

describe("Badge", () => {
  it("is a mono label with a hairline, and offers no status or destructive variant", () => {
    render(<Badge>Laser</Badge>);
    const badge = screen.getByText("Laser");
    expect(badge).toHaveAttribute("data-variant", "outline");
    expect(badge.className).toContain("font-mono");
    expect(badge.className).toContain("uppercase");
    // @ts-expect-error — status is StatusGlyph's job; Badge has no such variant.
    render(<Badge variant="destructive">x</Badge>);
  });

  it("can be a link to the filtered view", () => {
    render(
      <Badge asChild variant="accent">
        <Link href="/?category=laser">Laser</Link>
      </Badge>
    );
    expect(screen.getByRole("link", { name: "Laser" })).toHaveAttribute("data-slot", "badge");
  });
});

describe("Input and Checkbox", () => {
  it("an input is labelled by its visible label and bounded by the 3:1 control colour", () => {
    render(
      <label>
        Search
        <Input type="search" />
      </label>
    );
    const input = screen.getByRole("searchbox", { name: "Search" });
    expect(input.className).toContain("border-input");
  });

  it("a checkbox toggles by click and by Space, and reports an indeterminate state", async () => {
    const onChange = vi.fn();
    const { rerender } = render(<Checkbox aria-label="Select row" onCheckedChange={onChange} />);
    const box = screen.getByRole("checkbox", { name: "Select row" });
    expect(box).toHaveAttribute("aria-checked", "false");

    await userEvent.click(box);
    expect(onChange).toHaveBeenLastCalledWith(true);
    box.focus();
    await userEvent.keyboard(" ");
    expect(onChange).toHaveBeenCalledTimes(2);

    rerender(<Checkbox aria-label="Select row" checked="indeterminate" />);
    expect(screen.getByRole("checkbox", { name: "Select row" })).toHaveAttribute("aria-checked", "mixed");
  });
});

describe("DropdownMenu", () => {
  it("opens from its trigger, moves by keyboard, selects, and returns focus on Escape", async () => {
    const onSelect = vi.fn();
    render(
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button>State</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuLabel>Filter</DropdownMenuLabel>
          <DropdownMenuItem onSelect={onSelect}>Published</DropdownMenuItem>
          <DropdownMenuCheckboxItem checked>Drafts</DropdownMenuCheckboxItem>
        </DropdownMenuContent>
      </DropdownMenu>
    );
    const trigger = screen.getByRole("button", { name: "State" });
    trigger.focus();
    await userEvent.keyboard("{Enter}");

    const menu = await screen.findByRole("menu");
    expect(menu).toHaveAttribute("data-slot", "dropdown-menu-content");
    expect(screen.getByRole("menuitemcheckbox", { name: "Drafts" })).toHaveAttribute("aria-checked", "true");

    await userEvent.click(screen.getByRole("menuitem", { name: "Published" }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();

    await userEvent.click(trigger);
    await screen.findByRole("menu");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });
});

describe("Popover and Tooltip", () => {
  it("a popover opens on its trigger and closes on Escape", async () => {
    render(
      <Popover>
        <PopoverTrigger asChild>
          <Button>Columns</Button>
        </PopoverTrigger>
        <PopoverContent>Choose columns</PopoverContent>
      </Popover>
    );
    await userEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect(await screen.findByText("Choose columns")).toHaveAttribute("data-slot", "popover-content");
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByText("Choose columns")).not.toBeInTheDocument();
  });

  it("a tooltip appears on keyboard focus and describes its trigger", async () => {
    render(
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button size="icon" aria-label="Refresh research">
              ↻
            </Button>
          </TooltipTrigger>
          <TooltipContent>Research this tool again</TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
    await userEvent.tab();
    const trigger = screen.getByRole("button", { name: "Refresh research" });
    expect(trigger).toHaveFocus();
    expect(await screen.findByRole("tooltip")).toHaveTextContent("Research this tool again");
  });
});

describe("Table and Separator", () => {
  it("renders a real table with header cells, in the dense type step", () => {
    render(
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Tool</TableHead>
            <TableHead scope="col" className="text-end">
              Units
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <TableRow>
            <TableCell>Form 4</TableCell>
            <TableCell className="text-end tabular-nums">2</TableCell>
          </TableRow>
        </TableBody>
      </Table>
    );
    const table = screen.getByRole("table");
    expect(table.className).toContain("text-table");
    expect(screen.getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Tool", "Units"]);
    expect(screen.getByRole("cell", { name: "2" }).className).toContain("text-end");
  });

  it("a separator is decorative unless told otherwise", () => {
    const { container, rerender } = render(<Separator />);
    expect(container.querySelector('[data-slot="separator"]')).toHaveAttribute("role", "none");
    rerender(<Separator decorative={false} orientation="vertical" />);
    expect(screen.getByRole("separator")).toHaveAttribute("aria-orientation", "vertical");
  });
});
