import { describe, expect, it } from "vitest";
import { maskSerial, maskedSerialEnding } from "./serial-mask";

/** Students see a serial's last four characters, masked (data platform spec amendment 2026-10-06). */

describe("maskSerial", () => {
  it("shows the last four characters of a longer serial behind the mask", () => {
    expect(maskSerial("SN-2024-9831")).toBe("•••• 9831");
    expect(maskSerial("ML-F4-001")).toBe("•••• -001");
    expect(maskSerial("12345")).toBe("•••• 2345");
  });

  it("ignores surrounding spaces", () => {
    expect(maskSerial("  AB-9831  ")).toBe("•••• 9831");
  });

  it("shows nothing of a serial of four characters or fewer: that would be all of it", () => {
    expect(maskSerial("9831")).toBeUndefined();
    expect(maskSerial("831")).toBeUndefined();
    expect(maskSerial("1")).toBeUndefined();
    expect(maskSerial("  9831  ")).toBeUndefined();
  });

  it("shows nothing for no serial", () => {
    expect(maskSerial("")).toBeUndefined();
    expect(maskSerial("   ")).toBeUndefined();
    expect(maskSerial(null)).toBeUndefined();
    expect(maskSerial(undefined)).toBeUndefined();
  });
});

describe("maskedSerialEnding", () => {
  it("reads back the characters a masked serial shows", () => {
    expect(maskedSerialEnding("•••• 9831")).toBe("9831");
    expect(maskedSerialEnding(maskSerial("ML-F4-001") as string)).toBe("-001");
  });
});
