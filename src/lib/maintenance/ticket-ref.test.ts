// @vitest-environment node
import { ticketRef } from "./ticket-ref";

describe("ticketRef", () => {
  it("is the uuid's first eight hex characters, upper case", () => {
    expect(ticketRef("3f2a9c1d-55e0-4b6a-9d2e-0c1f2a3b4c5d")).toBe("3F2A9C1D");
  });

  it("skips anything that is not hex", () => {
    expect(ticketRef("3f-2a-9c-1d-ee")).toBe("3F2A9C1D");
  });
});
