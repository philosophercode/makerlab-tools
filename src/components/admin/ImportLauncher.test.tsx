vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { render, screen, userEvent } from "../../../test/utils/render";
import { ImportLauncher } from "./ImportLauncher";

/**
 * The import launcher's refusals (bulk intake spec, amendment 2026-09-24): a
 * document over the limit is told its size in pages and asked for parts; a
 * list over 1,000 items is told its count.
 */

function refusing(body: Record<string, unknown>): typeof fetch {
  return vi.fn(async () => Response.json(body, { status: 413 })) as unknown as typeof fetch;
}

async function paste(text: string) {
  await userEvent.click(screen.getByLabelText(/paste/i));
  await userEvent.paste(text);
  await userEvent.click(screen.getByRole("button", { name: /import/i }));
}

it("says a document is too long in pages, with the limit, and asks for parts", async () => {
  render(<ImportLauncher fetcher={refusing({ code: "document_too_long", pages: 85, limitPages: 60, limitChars: 200_000 })} />);
  await paste("A long document.");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This document is about 85 pages of text; the limit is about 60 pages (200,000 characters). Split it into parts and import each."
  );
});

it("says how many items a list has and the limit", async () => {
  render(<ImportLauncher fetcher={refusing({ code: "too_many_items", count: 1240, limit: 1000 })} />);
  await paste("Item\tQty");
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "This list has 1,240 items; the limit is 1,000 items per import. Split it into parts and import each."
  );
});
