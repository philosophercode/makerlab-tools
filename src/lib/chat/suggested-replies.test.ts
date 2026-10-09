// @vitest-environment node
import { cleanReplies, cleanReply, repliesAreDistinct, suggestedRepliesOf } from "./suggested-replies";

/**
 * The rules both ends of suggested replies apply (parity spec amendment
 * 2026-10-07 "Suggested replies"): the capability when the model calls it,
 * the chat when it draws a message, which is data.
 */

describe("cleanReply", () => {
  it("trims, joins words with one space and drops control and invisible characters", () => {
    expect(cleanReply("  Acrylic \n\t sign ")).toBe("Acrylic sign");
    expect(cleanReply("Acr\u0000ylic")).toBe("Acr ylic");
    expect(cleanReply("‮Acrylic​ sign﻿")).toBe("Acrylic sign");
  });

  it("keeps the joiners Devanagari and emoji need", () => {
    expect(cleanReply("क्‍ष")).toBe("क्‍ष");
  });
});

describe("repliesAreDistinct", () => {
  it("compares ignoring case and spacing", () => {
    expect(repliesAreDistinct(["Acrylic sign", "Engraved wood"])).toBe(true);
    expect(repliesAreDistinct(["Acrylic sign", " ACRYLIC  sign"])).toBe(false);
  });
});

describe("cleanReplies", () => {
  it("keeps two or three clean, distinct replies of at most 40 characters", () => {
    expect(cleanReplies(["Acrylic sign", "acrylic sign", "x".repeat(41), "", 7, "Engraved wood", "Cardboard", "Felt"])).toEqual([
      "Acrylic sign",
      "Engraved wood",
      "Cardboard",
    ]);
  });

  it("offers nothing for fewer than two, or for something that is not a list", () => {
    expect(cleanReplies(["Acrylic sign"])).toEqual([]);
    expect(cleanReplies(["Acrylic sign", "ACRYLIC SIGN"])).toEqual([]);
    expect(cleanReplies("Acrylic sign, Engraved wood")).toEqual([]);
    expect(cleanReplies(undefined)).toEqual([]);
  });
});

describe("suggestedRepliesOf", () => {
  const part = (state: string, output: unknown) => ({ type: "tool-suggest_replies", toolCallId: "c1", state, input: {}, output });

  it("reads the last finished call's output", () => {
    const parts = [
      { type: "text", text: "What are you cutting?" },
      part("output-available", { ok: true, replies: ["Plywood", "Acrylic"] }),
      part("output-available", { ok: true, replies: ["Acrylic sign", "Engraved wood"] }),
    ];
    expect(suggestedRepliesOf(parts)).toEqual(["Acrylic sign", "Engraved wood"]);
  });

  it("offers nothing while the call streams, after it failed, or when its output is not ok", () => {
    expect(suggestedRepliesOf([part("input-streaming", undefined)])).toEqual([]);
    expect(suggestedRepliesOf([part("input-available", undefined)])).toEqual([]);
    expect(suggestedRepliesOf([{ type: "tool-suggest_replies", state: "output-error", errorText: "Invalid input" }])).toEqual([]);
    expect(suggestedRepliesOf([part("output-available", { ok: false, replies: [] })])).toEqual([]);
    expect(suggestedRepliesOf([part("output-available", null)])).toEqual([]);
  });

  it("checks a stored output again", () => {
    expect(suggestedRepliesOf([part("output-available", { ok: true, replies: ["Acrylic sign", "x".repeat(60), "Engraved wood"] })])).toEqual([
      "Acrylic sign",
      "Engraved wood",
    ]);
  });

  it("offers nothing for a message without the tool", () => {
    expect(suggestedRepliesOf([{ type: "text", text: "Hello." }, null])).toEqual([]);
  });
});
