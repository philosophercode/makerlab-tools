import { render, screen, userEvent, within } from "../../../test/utils/render";
import type { McpToolSummary } from "../../lib/capabilities/mcp-catalog";
import type { TryItResult } from "../../lib/mcp/try-it";
import { McpTryIt, toArguments } from "./McpTryIt";

/**
 * "Try it" on `/mcp` (MCP access spec, amendment 2026-09-25): a form built from
 * each tool's input summary, and what came back — result, raw response, timing.
 */

const TOOLS: McpToolSummary[] = [
  {
    name: "search_tools",
    description: "Search the catalogue.",
    kind: "read",
    audience: "anyone",
    capabilityId: "catalog",
    fields: [{ name: "query", type: "string", required: true, description: "Search keyword or phrase" }],
  },
  {
    name: "list_widgets",
    description: "List widgets.",
    kind: "read",
    audience: "anyone",
    capabilityId: "demo",
    fields: [
      { name: "colour", type: "string", required: false, enumValues: ["red", "blue"] },
      { name: "limit", type: "integer", required: false },
    ],
  },
];

function ran(text: string, status = 200): TryItResult {
  return {
    ok: true,
    status,
    durationMs: 42,
    response: { jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text }] } },
  };
}

it("builds the form from the tool's inputs and runs it with what was typed", async () => {
  const runAction = vi.fn(async () => ran(JSON.stringify({ query: "laser", count: 1, tools: [{ name: "Trotec Speedy 400" }] })));
  render(<McpTryIt tools={TOOLS} runAction={runAction} />);

  const query = screen.getByLabelText("query");
  expect(query).toBeRequired();
  expect(query).toHaveAccessibleDescription("Search keyword or phrase");
  await userEvent.type(query, "laser");
  await userEvent.click(screen.getByRole("button", { name: "Run search_tools" }));

  expect(runAction).toHaveBeenCalledWith({ tool: "search_tools", arguments: { query: "laser" } });
  expect(await screen.findByText("HTTP 200 · 42 ms on the server")).toBeInTheDocument();
  const result = screen.getByText("Result").closest("details") as HTMLElement;
  expect(result).toHaveAttribute("open");
  expect(within(result).getByText(/"name": "Trotec Speedy 400"/)).toBeInTheDocument();
  const raw = screen.getByText("Raw JSON-RPC response").closest("details") as HTMLElement;
  expect(raw).not.toHaveAttribute("open");
  expect(within(raw).getByText(/"jsonrpc": "2.0"/)).toBeInTheDocument();
});

it("offers an enum as a select, and leaves empty optional fields out", async () => {
  const runAction = vi.fn(async () => ran("{}"));
  render(<McpTryIt tools={TOOLS} runAction={runAction} />);

  await userEvent.selectOptions(screen.getByLabelText("Tool"), "list_widgets");
  const colour = screen.getByLabelText("colour");
  expect(within(colour).getAllByRole("option").map((option) => option.textContent)).toEqual(["Any", "red", "blue"]);
  expect(screen.getByLabelText("limit")).toHaveAttribute("type", "number");

  await userEvent.click(screen.getByRole("button", { name: "Run list_widgets" }));
  expect(runAction).toHaveBeenLastCalledWith({ tool: "list_widgets", arguments: {} });

  await userEvent.selectOptions(colour, "blue");
  await userEvent.type(screen.getByLabelText("limit"), "3");
  await userEvent.click(screen.getByRole("button", { name: "Run list_widgets" }));
  expect(runAction).toHaveBeenLastCalledWith({ tool: "list_widgets", arguments: { colour: "blue", limit: 3 } });
});

it("says when the rate limit answered", async () => {
  const runAction = vi.fn(async (): Promise<TryItResult> => ({
    ok: true,
    status: 429,
    durationMs: 3,
    response: { jsonrpc: "2.0", error: { code: -32000, message: "Too many requests. Please wait a moment." }, id: null },
  }));
  render(<McpTryIt tools={TOOLS} runAction={runAction} />);
  await userEvent.type(screen.getByLabelText("query"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Run search_tools" }));
  expect(await screen.findByText(/Too many requests from your network/)).toBeInTheDocument();
  expect(screen.queryByText("Result")).toBeNull();
});

it("shows a refusal in words", async () => {
  const runAction = vi.fn(async (): Promise<TryItResult> => ({ ok: false, error: "not_runnable" }));
  render(<McpTryIt tools={TOOLS} runAction={runAction} />);
  await userEvent.type(screen.getByLabelText("query"), "x");
  await userEvent.click(screen.getByRole("button", { name: "Run search_tools" }));
  expect(await screen.findByText("This tool can't be run from this page.")).toBeInTheDocument();
});

it("tells the visitor it runs anonymously and writes can't be run", () => {
  render(<McpTryIt tools={TOOLS} runAction={vi.fn()} />);
  expect(screen.getByRole("heading", { name: "Try it" })).toBeInTheDocument();
  expect(screen.getByText(/always runs as an anonymous caller/)).toBeInTheDocument();
  expect(screen.getByText("Tools that change anything can't be run from here.")).toBeInTheDocument();
});

describe("toArguments", () => {
  it("drops empty values, turns numbers into numbers and keeps booleans", () => {
    expect(
      toArguments(
        [
          { name: "a", type: "string", required: false },
          { name: "n", type: "number", required: false },
          { name: "b", type: "boolean", required: false },
          { name: "e", type: "string", required: true, enumValues: ["x", "y"] },
        ],
        { a: "", n: "2.5", b: false }
      )
    ).toEqual({ n: 2.5, b: false, e: "x" });
  });
});
