import en from "../../../messages/en.json";
import { REDO_HIGHLIGHT_WINDOW_MS } from "../../lib/intake/limits";
import { recentlyUpdatedSections, redoWhat, type IntakeTranslate } from "./redo-status";

/** The words a guided redo is shown in (amendment "Guided redo (focus + guidance)"). */

/** A tiny `admin.intake` translator over the real English messages. */
const t: IntakeTranslate = (key, values = {}) => {
  let node: unknown = en.admin.intake;
  for (const part of key.split(".")) node = (node as Record<string, unknown>)[part];
  return String(node).replace(/\{(\w+)\}/g, (_, name: string) => String(values[name]));
};

describe("redoWhat", () => {
  it("names the focused sections as a list, or everything", () => {
    expect(redoWhat(t, "en", ["specs"])).toBe("Re-researching the specs…");
    expect(redoWhat(t, "en", ["description", "specs", "image"])).toBe(
      "Re-researching the description, the specs, and the image…"
    );
    expect(redoWhat(t, "en", null)).toBe("Researching everything again…");
    expect(redoWhat(t, "en", [], "notice")).toBe("Researching everything again. This page updates when it finishes.");
    expect(redoWhat(t, "en", ["links"], "notice")).toBe(
      "Re-researching links & manuals. This page updates when it finishes."
    );
  });
});

describe("recentlyUpdatedSections", () => {
  const at = "2026-09-23T12:00:00.000Z";
  const now = Date.parse(at);

  it("marks what a redo changed only just after it landed", () => {
    expect(recentlyUpdatedSections({ at, sections: ["specs"] }, now + 1_000)).toEqual(["specs"]);
    expect(recentlyUpdatedSections({ at, sections: ["specs"] }, now + REDO_HIGHLIGHT_WINDOW_MS + 1)).toEqual([]);
    expect(recentlyUpdatedSections({ at, sections: [] }, now)).toEqual([]);
    expect(recentlyUpdatedSections(null, now)).toEqual([]);
    expect(recentlyUpdatedSections({ at: "not a date", sections: ["image"] }, now)).toEqual([]);
  });
});
