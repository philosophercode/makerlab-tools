import type { ImageCandidate } from "../research/result";
import { foundPhotoEligible, parseFoundPhoto, type FoundPhoto, type FoundPhotoSubject } from "./found-photo";
import { IDENTIFY_PHOTO_STALE_MS } from "./limits";
import { effectiveFoundPhotoStatus, foundPhotoHost, foundPhotoStale, toFoundPhotoView } from "./view";

/**
 * A photo for an item named without one (data platform spec amendment "A
 * photo for a name"): the stored shape, staleness, which items get a lookup,
 * and what a browser is shown.
 */

const CANDIDATE: ImageCandidate = {
  url: "https://cdn.maker.example/img/x2d-front.png",
  pageUrl: "https://www.maker.example/x2d",
  source: "exa",
  width: 1200,
  height: 900,
  contentType: "image/png",
  rank: 1,
  reason: "the front of the printer",
};

function photo(over: Partial<FoundPhoto> = {}): FoundPhoto {
  return {
    requestId: "5b0c1f7e-7a39-4ff8-9b0e-9c2d4f1a6e01",
    requestedAt: new Date().toISOString(),
    status: "found",
    candidate: CANDIDATE,
    cleaned: null,
    error: null,
    ...over,
  };
}

function subject(over: Partial<FoundPhotoSubject> = {}): FoundPhotoSubject {
  return {
    id: crypto.randomUUID(),
    status: "identified",
    photos: [],
    identifyConfidence: "likely",
    duplicateOf: null,
    duplicateResolution: null,
    importId: null,
    foundPhoto: null,
    ...over,
  };
}

describe("parseFoundPhoto", () => {
  it("reads a stored lookup and refuses one that is not the shape", () => {
    expect(parseFoundPhoto(photo())).toEqual(photo({ requestedAt: expect.any(String) as unknown as string }));
    expect(parseFoundPhoto(null)).toBeNull();
    expect(parseFoundPhoto({ status: "found" })).toBeNull();
    expect(parseFoundPhoto({ ...photo(), status: "maybe" })).toBeNull();
  });
});

describe("staleness", () => {
  it("reads a search that has run too long as failed, and nothing else", () => {
    const now = Date.now();
    const old = new Date(now - IDENTIFY_PHOTO_STALE_MS - 1000).toISOString();
    expect(foundPhotoStale({ status: "searching", requestedAt: old }, now)).toBe(true);
    expect(effectiveFoundPhotoStatus({ status: "searching", requestedAt: old }, now)).toBe("failed");
    expect(effectiveFoundPhotoStatus({ status: "searching", requestedAt: new Date(now).toISOString() }, now)).toBe("searching");
    expect(effectiveFoundPhotoStatus({ status: "found", requestedAt: old }, now)).toBe("found");
  });
});

describe("foundPhotoEligible", () => {
  it("picks items named without a photo, in order", () => {
    const a = subject();
    const b = subject();
    expect(foundPhotoEligible([a, b])).toEqual([a.id, b.id]);
  });

  it("leaves out an item with a photo, an unsure one, an undecided duplicate, an imported one and one already looked up", () => {
    const items = [
      subject({ photos: [{}] }),
      subject({ identifyConfidence: "unsure" }),
      subject({ duplicateOf: { kind: "tool" }, duplicateResolution: null }),
      subject({ duplicateOf: { kind: "tool" }, duplicateResolution: "add_unit" }),
      subject({ importId: crypto.randomUUID() }),
      subject({ foundPhoto: photo() }),
      subject({ status: "queued" }),
    ];
    expect(foundPhotoEligible(items)).toEqual([]);
    // A merely similar name is stored pre-resolved as a different tool: it gets one.
    const similar = subject({ duplicateOf: { kind: "tool" }, duplicateResolution: "new_tool" });
    expect(foundPhotoEligible([similar])).toEqual([similar.id]);
  });
});

describe("foundPhotoHost", () => {
  it("names the page's host, else the picture's", () => {
    expect(foundPhotoHost(CANDIDATE)).toBe("maker.example");
    expect(foundPhotoHost({ url: CANDIDATE.url, pageUrl: null })).toBe("cdn.maker.example");
  });
});

describe("toFoundPhotoView", () => {
  const id = "0f6f2b3e-1d7a-4c55-9f2a-1b8e7d3c4a99";

  it("shows the private cleaned copy through our route", () => {
    const view = toFoundPhotoView(id, "identified", photo({ cleaned: { attachmentId: crypto.randomUUID(), fromUrl: CANDIDATE.url } }));
    expect(view).toEqual({
      status: "found",
      src: `/api/pending-tools/${id}/found-photo`,
      external: false,
      cleaned: true,
      host: "maker.example",
      pageUrl: CANDIDATE.pageUrl,
    });
  });

  it("shows the picture from its own host when there is no cleaned copy", () => {
    expect(toFoundPhotoView(id, "researched", photo())).toMatchObject({ status: "found", src: CANDIDATE.url, external: true, cleaned: false });
  });

  it("shows nothing for a settled item, and a stale search as failed", () => {
    expect(toFoundPhotoView(id, "approved", photo())).toBeNull();
    expect(toFoundPhotoView(id, "discarded", photo())).toBeNull();
    expect(toFoundPhotoView(id, "identified", null)).toBeNull();
    const stale = photo({ status: "searching", candidate: null, requestedAt: new Date(Date.now() - IDENTIFY_PHOTO_STALE_MS - 1000).toISOString() });
    expect(toFoundPhotoView(id, "identified", stale)).toMatchObject({ status: "failed", src: null });
  });
});
