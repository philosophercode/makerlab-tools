import type { UIMessage } from "ai";
import { toVisionFileParts, withRecentPhotos } from "./photo-parts";

/**
 * Photos as the model sees them (intake spec §6.1, amendment 2026-09-14).
 */

function photo(n: number) {
  return {
    type: "file" as const,
    mediaType: "image/jpeg",
    filename: `p${n}.jpg`,
    url: `data:image/jpeg;base64,P${n}`,
  };
}

function text(value: string) {
  return { type: "text" as const, text: value };
}

function user(id: string, ...parts: UIMessage["parts"]): UIMessage {
  return { id, role: "user", parts };
}

function assistant(id: string, value: string): UIMessage {
  return { id, role: "assistant", parts: [text(value)] };
}

function photosIn(message: UIMessage): (string | undefined)[] {
  return message.parts
    .filter((part) => part.type === "file")
    .map((part) => (part as { filename?: string }).filename);
}

describe("toVisionFileParts", () => {
  it("turns each encoded photo into an image file part", () => {
    expect(
      toVisionFileParts([{ name: "plate.png", dataUrl: "data:image/png;base64,AAA" }])
    ).toEqual([
      {
        type: "file",
        mediaType: "image/png",
        filename: "plate.png",
        url: "data:image/png;base64,AAA",
      },
    ]);
  });

  it("skips a photo the browser could not encode", () => {
    const parts = toVisionFileParts([
      { name: "label.heic" },
      { name: "front.jpg", dataUrl: "data:image/jpeg;base64,BBB" },
    ]);
    expect(parts.map((p) => p.filename)).toEqual(["front.jpg"]);
  });

  it("sends nothing when there are no photos", () => {
    expect(toVisionFileParts([])).toEqual([]);
  });
});

describe("withRecentPhotos", () => {
  it("keeps every photo on the latest user message, however many", () => {
    const latest = user("u1", text("what are these?"), ...[1, 2, 3, 4, 5, 6].map(photo));
    const [out] = withRecentPhotos([latest]);
    expect(photosIn(out)).toHaveLength(6);
  });

  it("keeps up to the limit from earlier turns, newest first, and drops the rest", () => {
    const messages = [
      user("u1", text("first"), photo(1), photo(2), photo(3)),
      assistant("a1", "ok"),
      user("u2", text("second"), photo(4), photo(5)),
      assistant("a2", "ok"),
      user("u3", text("a follow-up about those photos")),
    ];

    const out = withRecentPhotos(messages, 3);

    expect(photosIn(out[2])).toEqual(["p4.jpg", "p5.jpg"]);
    expect(photosIn(out[0])).toEqual(["p3.jpg"]);
  });

  it("never removes text, including the upload hint", () => {
    const hint =
      "[Attached photos: attachment_id=3f2504e0-4f89-41d3-9a0c-0305e82c3301 name=p1.jpg]";
    const messages = [user("u1", text(hint), photo(1)), user("u2", text("next"))];

    const out = withRecentPhotos(messages, 0);

    expect(out[0].parts).toEqual([text(hint)]);
  });

  it("leaves assistant messages and non-image files alone", () => {
    const manual = {
      type: "file" as const,
      mediaType: "application/pdf",
      filename: "manual.pdf",
      url: "data:application/pdf;base64,QQ",
    };
    const messages = [
      user("u1", text("here is the manual"), manual),
      assistant("a1", "read it"),
      user("u2", text("thanks")),
    ];

    const out = withRecentPhotos(messages, 0);

    expect(out[0]).toBe(messages[0]);
    expect(out[1]).toBe(messages[1]);
  });
});
