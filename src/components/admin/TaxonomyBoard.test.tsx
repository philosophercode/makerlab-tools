import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { TaxonomyActions } from "../../app/admin/taxonomy/action-result";
import { TaxonomyBoard, type TaxonomyProposalRow } from "./TaxonomyBoard";
import { buildTaxonomyTree, categoryChoices, type TaxonomyCategoryRow, type TaxonomyToolRow } from "./taxonomy-tree";

/**
 * `/admin/taxonomy`'s island (taxonomy v2 spec §5.3): the queue first, then
 * the tree with counts and descriptions; every control calls its server
 * action with ids, and merge asks for a second click.
 */

function cat(partial: Partial<TaxonomyCategoryRow> & { id: string; name: string }): TaxonomyCategoryRow {
  return {
    slug: partial.id,
    group: null,
    description: null,
    parentId: null,
    sortOrder: 10,
    galleryHidden: false,
    retiredAt: null,
    mergedIntoId: null,
    toolCount: 0,
    ...partial,
  };
}

const CATEGORIES: TaxonomyCategoryRow[] = [
  cat({ id: "power-tools", name: "Power Tools", sortOrder: 10, description: "Tools with a motor." }),
  cat({ id: "sanders", name: "Sanders", parentId: "power-tools", sortOrder: 10, toolCount: 2, description: "Orbital and belt sanders." }),
  cat({ id: "nailers", name: "Nailers", parentId: "power-tools", sortOrder: 20, toolCount: 0 }),
  cat({ id: "shop", name: "Shop Infrastructure & Supplies", sortOrder: 20, galleryHidden: true }),
  cat({ id: "old", name: "Hand Saw", group: "Woodworking", toolCount: 1 }),
  cat({ id: "gone", name: "Gone", retiredAt: "2026-09-28T00:00:00.000Z", mergedIntoId: "sanders" }),
];

const TOOLS: TaxonomyToolRow[] = [
  { id: "t1", slug: "orbital", name: "Orbital Sander", revision: "1", categoryId: "sanders" },
  { id: "t2", slug: "belt", name: "Belt Sander", revision: "1", categoryId: "sanders" },
  { id: "t3", slug: "saw", name: "Old Saw", revision: "1", categoryId: "old" },
];

const PROPOSAL: TaxonomyProposalRow = {
  id: "p1",
  kind: "new_category",
  name: "Oscillating Tools",
  parentId: "power-tools",
  description: "Multi-tools with an oscillating head.",
  reason: "None of the power tool categories fits.",
  source: "research",
  subjectType: "tool",
  subjectId: "t9",
  subjectName: "Multi-Tool X",
  flag: null,
  nearestExistingId: "sanders",
  status: "pending",
  resultingCategoryId: null,
};

function actions(): TaxonomyActions {
  return {
    decide: vi.fn(async () => ({ ok: true as const })),
    propose: vi.fn(async () => ({ ok: true as const })),
    merge: vi.fn(async () => ({ ok: true as const })),
    edit: vi.fn(async () => ({ ok: true as const })),
    setRetired: vi.fn(async () => ({ ok: true as const })),
    recategorize: vi.fn(async () => ({ ok: true as const })),
  };
}

function renderBoard(proposals: TaxonomyProposalRow[] = [PROPOSAL]) {
  const handed = actions();
  render(<TaxonomyBoard categories={CATEGORIES} tools={TOOLS} proposals={proposals} actions={handed} />);
  return handed;
}

describe("buildTaxonomyTree", () => {
  it("nests children under their parent with totals, keeps old rows and retired ones apart", () => {
    const tree = buildTaxonomyTree(CATEGORIES, TOOLS);
    expect(tree.roots.map((root) => [root.category.id, root.total, root.children.map((child) => child.category.id)])).toEqual([
      ["power-tools", 2, ["sanders", "nailers"]],
      ["shop", 0, []],
    ]);
    expect(tree.legacy.map((node) => node.category.id)).toEqual(["old"]);
    expect(tree.retired.map((category) => category.id)).toEqual(["gone"]);
    expect(categoryChoices(tree).map((choice) => choice.label)).toEqual([
      "Power Tools",
      "Power Tools › Sanders",
      "Power Tools › Nailers",
      "Shop Infrastructure & Supplies",
      "Woodworking › Hand Saw",
    ]);
  });
});

describe("TaxonomyBoard", () => {
  it("puts the waiting proposal first, with its reason, tool and research's nearest category", () => {
    renderBoard();
    const card = screen.getByRole("article", { name: "Proposal: Oscillating Tools" });
    expect(within(card).getByText("Power Tools › Oscillating Tools")).toBeInTheDocument();
    expect(within(card).getByText(/None of the power tool categories fits/)).toBeInTheDocument();
    expect(within(card).getByText(/Prompted by Multi-Tool X/)).toBeInTheDocument();
    expect(within(card).getByText(/nearest existing category: Sanders/)).toBeInTheDocument();
  });

  it("accepts, merges into the chosen category, or rejects — by id", async () => {
    const handed = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Accept" }));
    expect(handed.decide).toHaveBeenCalledWith({ proposalId: "p1", decision: "accept", targetCategoryId: null });
    expect(await screen.findByText("Accepted: the category exists now.")).toBeInTheDocument();
  });

  it("merges a proposal into research's nearest category by default", async () => {
    const handed = renderBoard();
    await userEvent.click(screen.getByRole("button", { name: "Use this category instead" }));
    expect(handed.decide).toHaveBeenCalledWith({ proposalId: "p1", decision: "merge", targetCategoryId: "sanders" });
  });

  it("says so when nothing waits", () => {
    renderBoard([]);
    expect(screen.getByText(/Nothing is waiting/)).toBeInTheDocument();
  });

  it("shows the tree with counts, slugs, descriptions and the hidden flag", () => {
    renderBoard();
    const sanders = document.querySelector('[data-category="sanders"]') as HTMLElement;
    expect(within(sanders).getByText("sanders")).toBeInTheDocument();
    expect(within(sanders).getByText("2 tools")).toBeInTheDocument();
    expect(within(sanders).getByText("Orbital and belt sanders.")).toBeInTheDocument();
    const shop = document.querySelector('[data-category="shop"]') as HTMLElement;
    expect(within(shop).getByText("Hidden from the gallery")).toBeInTheDocument();
    expect(screen.getByText(/1 old category not yet migrated/)).toBeInTheDocument();
  });

  it("merges a category only on a second click that names both", async () => {
    const handed = renderBoard();
    const sanders = document.querySelector('[data-category="sanders"]') as HTMLElement;
    await userEvent.selectOptions(within(sanders).getByLabelText("Category for Sanders"), "nailers");
    await userEvent.click(within(sanders).getByRole("button", { name: "Merge" }));
    expect(handed.merge).not.toHaveBeenCalled();
    await userEvent.click(within(sanders).getByRole("button", { name: /Merge Sanders into Power Tools › Nailers/ }));
    expect(handed.merge).toHaveBeenCalledWith({ fromId: "sanders", intoId: "nailers" });
  });

  it("retires only an empty category, and moves a tool by its revision", async () => {
    const handed = renderBoard();
    const nailers = document.querySelector('[data-category="nailers"]') as HTMLElement;
    await userEvent.click(within(nailers).getByRole("button", { name: "Retire" }));
    expect(handed.setRetired).toHaveBeenCalledWith({ categoryId: "nailers", retired: true });
    const sanders = document.querySelector('[data-category="sanders"]') as HTMLElement;
    expect(within(sanders).getByRole("button", { name: "Retire" })).toBeDisabled();

    await userEvent.click(within(sanders).getByText(/2 tools — move one/));
    await userEvent.selectOptions(within(sanders).getByLabelText("Category for Orbital Sander"), "nailers");
    expect(handed.recategorize).toHaveBeenCalledWith({ toolId: "t1", expectedRevision: "1", categoryId: "nailers" });
  });

  it("proposes a category from the form", async () => {
    const handed = renderBoard([]);
    await userEvent.click(screen.getByRole("button", { name: "Propose a category" }));
    await userEvent.type(screen.getByLabelText("Name"), "Oscillating Tools");
    await userEvent.selectOptions(screen.getByLabelText("Under"), "power-tools");
    await userEvent.click(screen.getByRole("button", { name: "Propose" }));
    expect(handed.propose).toHaveBeenCalledWith({ name: "Oscillating Tools", parentId: "power-tools", description: null, reason: null });
    expect(await screen.findByText(/Proposed “Oscillating Tools”/)).toBeInTheDocument();
  });
});
