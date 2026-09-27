import { beforeEach, describe, expect, it, vi } from "vitest";

const put = vi.fn(async (pathname: string, _body: unknown, _options: Record<string, unknown>) => ({
  pathname: `${pathname}-x`,
  url: `https://blob.test/${pathname}-x`,
}));
vi.mock("@vercel/blob", () => ({
  put: (pathname: string, body: unknown, options: Record<string, unknown>) => put(pathname, body, options),
}));

const { createHostedBlobUploader } = await import("./blob-target.ts");

describe("createHostedBlobUploader", () => {
  beforeEach(() => put.mockClear());
  const bytes = new Uint8Array([1, 2, 3]);

  it("sends private files to the private store and public files to the public one", async () => {
    const up = createHostedBlobUploader({ kind: "token", token: "pub" }, { kind: "token", token: "priv" });
    await up.put("a.png", bytes, { access: "public", contentType: "image/png" });
    await up.put("b.json", bytes, { access: "private", contentType: "application/json" });
    expect(put.mock.calls[0][2]).toMatchObject({ access: "public", token: "pub" });
    expect(put.mock.calls[1][2]).toMatchObject({ access: "private", token: "priv" });
  });

  it("uses the one store for both when no private store is given", async () => {
    const up = createHostedBlobUploader({ kind: "token", token: "pub" });
    await up.put("b.json", bytes, { access: "private" });
    expect(put.mock.calls[0][2]).toMatchObject({ access: "private", token: "pub" });
  });
});
