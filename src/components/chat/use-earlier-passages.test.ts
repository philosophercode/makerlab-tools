import type { UIMessage } from "ai";
import { earlierPassagesByMessage } from "./use-earlier-passages";

const search = (ref: string, page: number) => ({
  type: "tool-search_manual",
  state: "output-available",
  output: {
    status: "ok",
    passages: [{ ref, citation: `Form 4 Manual, p. ${page}`, url: `https://blob.test/form-4.pdf#page=${page}`, tool: "Form 4", text: "…" }],
  },
});
const msg = (id: string, role: "user" | "assistant", parts: unknown[]): UIMessage => ({ id, role, parts }) as unknown as UIMessage;

describe("earlierPassagesByMessage", () => {
  const u1 = msg("u1", "user", [{ type: "text", text: "Resin tank?" }]);
  const a1 = msg("a1", "assistant", [search("3f2a9c10-42", 42), { type: "text", text: "Lift it." }]);
  const u2 = msg("u2", "user", [{ type: "text", text: "Cleaning?" }]);
  const a2 = msg("a2", "assistant", [{ type: "text", text: "Wipe it." }]);

  it("gives each later message the passages earlier turns returned, and the first turn none", () => {
    const earlier = earlierPassagesByMessage([u1, a1, u2, a2]);
    expect(earlier.has("u1")).toBe(false);
    expect(earlier.has("a1")).toBe(false);
    expect(earlier.get("a2")?.get("#cite-3f2a9c10-42")?.citation).toBe("Form 4 Manual, p. 42");
  });

  it("keeps each map's identity while only the streaming message changes", () => {
    const first = earlierPassagesByMessage([u1, a1, u2, a2]);
    const streaming = msg("a2", "assistant", [{ type: "text", text: "Wipe it with IPA." }]);
    const second = earlierPassagesByMessage([u1, a1, u2, streaming]);
    expect(second.get("a2")).toBe(first.get("a2"));
    expect(second.get("u2")).toBe(first.get("u2"));
  });
});
