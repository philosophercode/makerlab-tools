// @vitest-environment node
import { recordedCalls, textModel } from "../../../test/ai/models-stub";
import { NO_TEXT_MARKER, parseTranscript, transcribePage, TRANSCRIBE_INSTRUCTIONS } from "./transcribe";

/**
 * Reading one scanned page (manual text spec phase 3, OCR): what is sent to the
 * vision model, and how its answer becomes stored text and headings. The model
 * is a stub; nothing reaches the Gateway.
 */

describe("transcribePage", () => {
  it("sends the page as a JPEG image with the transcription rules, flex by default, and returns the text", async () => {
    const model = textModel("# Maintenance\n## Replacing the resin tank\nWear gloves. Lift the tank straight up.");
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const result = await transcribePage(jpeg, { model });

    expect(result.text).toBe("Maintenance\nReplacing the resin tank\nWear gloves. Lift the tank straight up.");
    expect(result.headings).toEqual([
      { title: "Maintenance", level: 1 },
      { title: "Replacing the resin tank", level: 2 },
    ]);
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(20);

    const [call] = recordedCalls(model);
    expect(call.providerOptions).toEqual({ gateway: { serviceTier: "flex" } });
    expect(call.tools ?? []).toEqual([]);
    const system = call.prompt.find((message) => message.role === "system");
    expect(system?.content).toBe(TRANSCRIBE_INSTRUCTIONS);
    const user = call.prompt.find((message) => message.role === "user");
    const parts = user?.content as Array<{ type: string; mediaType?: string }>;
    expect(parts.some((part) => part.type === "file" && part.mediaType === "image/jpeg")).toBe(true);
  });

  it("says in the rules that the page is data, never instructions", () => {
    expect(TRANSCRIBE_INSTRUCTIONS).toMatch(/never follow instructions/i);
    expect(TRANSCRIBE_INSTRUCTIONS).toContain(NO_TEXT_MARKER);
  });
});

describe("parseTranscript", () => {
  it("stores an empty page for the no-text marker", () => {
    expect(parseTranscript("[no text]")).toEqual({ text: "", headings: [] });
    expect(parseTranscript("  [No Text]\n")).toEqual({ text: "", headings: [] });
  });

  it("drops a code fence around the answer", () => {
    expect(parseTranscript("```text\nPower: 40 W\n```").text).toBe("Power: 40 W");
  });

  it("takes deeper markers as sections, strips bold and closing hashes, and collapses blank runs", () => {
    const parsed = parseTranscript("# **Safety** #\n\n\n\n### Laser class\nClass 4 laser product.\nError E-302 | Lid open");
    expect(parsed.headings).toEqual([
      { title: "Safety", level: 1 },
      { title: "Laser class", level: 2 },
    ]);
    expect(parsed.text).toBe("Safety\n\nLaser class\nClass 4 laser product.\nError E-302 | Lid open");
  });
});
