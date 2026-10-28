import type { ImageCandidate, ResearchImages } from "../research/result";
import { imageVerdict } from "./image-verdict";

/** Photo verdicts from research's stored vision ranking (assistant cleanup spec 2026-10-28 §4). */

const candidate = (over: Partial<ImageCandidate> = {}): ImageCandidate => ({
  url: "https://maker.example/h2d.png",
  pageUrl: "https://maker.example/h2d",
  source: "og",
  width: 1200,
  height: 900,
  contentType: "image/png",
  rank: 1,
  reason: "Front view",
  background: "plain",
  view: "front",
  ...over,
});

const images = (first: ImageCandidate | null, cleaned = false): ResearchImages => ({
  candidates: first ? [first] : [],
  cleaned: cleaned ? { attachmentId: "a1", fromUrl: first?.url ?? "" } : null,
});

describe("imageVerdict", () => {
  it("passes a clean front or three-quarter photo of the whole product", () => {
    expect(imageVerdict(images(candidate()))).toEqual({ verdict: "good", reasons: ["front view of the whole product", "plain background"] });
    expect(imageVerdict(images(candidate({ view: "three_quarter", background: "busy" }), true))).toMatchObject({ verdict: "good" });
  });

  it("asks for a look at a banner, a back view, a small or busy photo, or one ranked before views", () => {
    expect(imageVerdict(images(candidate({ composite: true })))).toMatchObject({ verdict: "check", reasons: ["banner, collage or busy scene"] });
    expect(imageVerdict(images(candidate({ view: "back" })))).toMatchObject({ verdict: "check", reasons: ["back view, not the front"] });
    expect(imageVerdict(images(candidate({ width: 300, height: 300 })))).toMatchObject({ verdict: "check", reasons: ["small (300×300)"] });
    expect(imageVerdict(images(candidate({ background: "busy" })))).toMatchObject({ verdict: "check", reasons: ["busy background, not cleaned"] });
    expect(imageVerdict(images(candidate({ view: undefined })))).toMatchObject({ verdict: "check" });
  });

  it("says when there is no photo, or only an uploaded one nobody judged", () => {
    expect(imageVerdict(images(null))).toMatchObject({ verdict: "none" });
    expect(imageVerdict(null)).toMatchObject({ verdict: "none" });
    expect(imageVerdict(images(null), [{ attachmentId: "x" }])).toMatchObject({ verdict: "check", reasons: ["uploaded photo, not judged by research"] });
  });
});
