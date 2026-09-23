// @vitest-environment node
import {
  MirrorKeyUnavailableError,
  MirrorTokenUnreadableError,
  decryptMirrorToken,
  encryptMirrorToken,
  mirrorKeyAvailable,
} from "./token-crypto";

/**
 * The mirror token at rest (spec §8, §10 "Token encryption: round-trips; a
 * different key fails to decrypt"). Nothing here reads a real secret: every
 * secret is a test string, passed explicitly or through `vi.stubEnv`.
 */
const TOKEN = "ntn_TESTtoken0123456789abcdefABCDEF";
const SECRET = "test-auth-secret-for-mirror-crypto";

function errorOf(fn: () => unknown): Error {
  try {
    fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error("expected a throw");
}

describe("mirror token encryption", () => {
  it("round-trips", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    expect(stored).toBeInstanceOf(Uint8Array);
    expect(stored[0]).toBe(0x01);
    expect(stored.length).toBe(1 + 12 + 16 + Buffer.byteLength(TOKEN));
    expect(decryptMirrorToken(stored, SECRET)).toBe(TOKEN);
  });

  it("reads AUTH_SECRET from the environment by default", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const stored = encryptMirrorToken(TOKEN);
    expect(decryptMirrorToken(stored)).toBe(TOKEN);
    expect(decryptMirrorToken(stored, SECRET)).toBe(TOKEN);
  });

  it("fails to decrypt under a different AUTH_SECRET", () => {
    vi.stubEnv("AUTH_SECRET", SECRET);
    const stored = encryptMirrorToken(TOKEN);

    vi.stubEnv("AUTH_SECRET", "a-rotated-auth-secret");
    expect(() => decryptMirrorToken(stored)).toThrow(MirrorTokenUnreadableError);
  });

  it("fails on a tampered byte anywhere", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    for (const index of [5, 20, stored.length - 1]) {
      const tampered = new Uint8Array(stored);
      tampered[index] ^= 0x01;
      expect(() => decryptMirrorToken(tampered, SECRET)).toThrow(MirrorTokenUnreadableError);
    }
  });

  it("fails on a truncated value or an unknown version", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    expect(() => decryptMirrorToken(stored.subarray(0, 29), SECRET)).toThrow(MirrorTokenUnreadableError);
    const versioned = new Uint8Array(stored);
    versioned[0] = 0x02;
    expect(() => decryptMirrorToken(versioned, SECRET)).toThrow(MirrorTokenUnreadableError);
  });

  it("never encrypts the same token to the same bytes", () => {
    const a = encryptMirrorToken(TOKEN, SECRET);
    const b = encryptMirrorToken(TOKEN, SECRET);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  it("does not contain the plaintext", () => {
    const stored = Buffer.from(encryptMirrorToken(TOKEN, SECRET));
    expect(stored.includes(Buffer.from(TOKEN))).toBe(false);
    expect(stored.includes(Buffer.from(TOKEN.slice(0, 12)))).toBe(false);
  });

  it("refuses an empty secret as an unavailable key", () => {
    expect(() => encryptMirrorToken(TOKEN, "")).toThrow(MirrorKeyUnavailableError);
    expect(() => decryptMirrorToken(encryptMirrorToken(TOKEN, SECRET), "")).toThrow(MirrorKeyUnavailableError);
    vi.stubEnv("AUTH_SECRET", "");
    expect(() => encryptMirrorToken(TOKEN)).toThrow(MirrorKeyUnavailableError);
  });

  it("says whether a key is available", () => {
    expect(mirrorKeyAvailable(SECRET)).toBe(true);
    expect(mirrorKeyAvailable("")).toBe(false);
    expect(mirrorKeyAvailable("   ")).toBe(false);
    vi.stubEnv("AUTH_SECRET", "");
    expect(mirrorKeyAvailable()).toBe(false);
    vi.stubEnv("AUTH_SECRET", SECRET);
    expect(mirrorKeyAvailable()).toBe(true);
  });

  it("puts neither the token nor the secret into any error", () => {
    const stored = encryptMirrorToken(TOKEN, SECRET);
    const tampered = new Uint8Array(stored);
    tampered[stored.length - 1] ^= 0xff;
    const errors = [
      errorOf(() => decryptMirrorToken(stored, "another-secret")),
      errorOf(() => decryptMirrorToken(tampered, SECRET)),
      errorOf(() => encryptMirrorToken(TOKEN, "")),
    ];
    for (const error of errors) {
      const text = `${error.name} ${error.message} ${error.stack ?? ""} ${String(error.cause ?? "")}`;
      expect(text).not.toContain(TOKEN);
      expect(text).not.toContain(SECRET);
      expect(error.cause).toBeUndefined();
    }
  });
});
