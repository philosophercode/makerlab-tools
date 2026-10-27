import { ENGLISH, escapeIcu, withLabTokens } from "./lab-tokens";

const values = {
  labName: "Fab Lab",
  assistantName: "Fab AI",
  siteName: "Fab Tools",
  institution: "Example University",
  emailDomain: "example.edu",
};

describe("lab tokens in messages (lab config spec §12.2)", () => {
  it("fills every token, at any depth, and leaves other arguments alone", () => {
    const filled = withLabTokens(
      { a: "Ask {assistantName} at the {labName}", b: { c: "{siteName}, {institution}, {emailDomain}", d: "Hi {name}" } },
      values
    );
    expect(filled).toEqual({
      a: "Ask Fab AI at the Fab Lab",
      b: { c: "Fab Tools, Example University, example.edu", d: "Hi {name}" },
    });
  });

  it("escapes a value so ICU and rich text read it as written", () => {
    expect(escapeIcu("Kids' {Lab} <b>")).toBe("Kids'' '{'Lab'}' '<'b'>'");
  });

  it("fills the shipped English catalog from the shipped config", () => {
    const text = JSON.stringify(ENGLISH);
    for (const token of ["{labName}", "{assistantName}", "{siteName}", "{emailDomain}"]) expect(text).not.toContain(token);
    expect(text).toContain("MakerLAB AI");
  });
});
