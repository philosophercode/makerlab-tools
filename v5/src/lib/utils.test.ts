import { cn } from "./utils";

describe("cn", () => {
  it("joins conditional classes and lets a later utility win a conflict", () => {
    expect(cn("px-2", false && "hidden", ["h-8"], { "text-bad": true })).toBe("px-2 h-8 text-bad");
    expect(cn("h-8 px-3", "h-6")).toBe("px-3 h-6");
  });

  it("treats the UI system's type steps as sizes, so a text colour does not erase them", () => {
    expect(cn("text-label", "text-primary-foreground")).toBe("text-label text-primary-foreground");
    expect(cn("text-table text-muted-foreground", "text-micro")).toBe("text-muted-foreground text-micro");
  });
});
