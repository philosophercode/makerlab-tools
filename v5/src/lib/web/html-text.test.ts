// @vitest-environment node
import { decodeEntities, extractPage } from "./html-text";

/**
 * HTML to text and the declared product images (gateway spec §3.3, §3.5,
 * §10 "Unit": text extraction; og:image / twitter:image / JSON-LD, including
 * arrays and `@graph`).
 */

const PAGE = "https://maker.test/products/p1s";

function page(head: string, body: string): string {
  return `<!doctype html><html><head>${head}</head><body>${body}</body></html>`;
}

describe("extractPage — text", () => {
  it("keeps the content and drops scripts, styles, navigation, headers, footers, asides, forms and svg", () => {
    const html = page(
      `<title>Bambu Lab P1S &amp; AMS</title><style>body { color: red }</style><script>var secret = "x";</script>`,
      `<header><a href="/">Home</a> | Shop</header>
       <nav><ul><li>Printers</li><li>Filament</li></ul></nav>
       <div class="content">
         <h1>P1S</h1>
         <p>An enclosed   CoreXY printer.</p>
         <p>Build volume:&nbsp;256 &times; 256 &times; 256 mm</p>
         <noscript>Enable JavaScript</noscript>
         <svg><text>logo</text></svg>
         <form><label>Email</label><input name="e"></form>
       </div>
       <aside>Related: X1C</aside>
       <footer>© Bambu Lab</footer>`
    );

    const { title, text } = extractPage(html, PAGE);

    expect(title).toBe("Bambu Lab P1S & AMS");
    expect(text).toBe("P1S\nAn enclosed CoreXY printer.\nBuild volume: 256 × 256 × 256 mm");
    for (const gone of ["secret", "color", "Home", "Printers", "Enable JavaScript", "logo", "Email", "Related", "©"]) {
      expect(text).not.toContain(gone);
    }
  });

  it("prefers <main> when the page has one", () => {
    const html = page("", `<div>Cookie banner text</div><main><h2>Specs</h2><p>Nozzle 0.4 mm</p></main><div>Newsletter</div>`);
    expect(extractPage(html, PAGE).text).toBe("Specs\nNozzle 0.4 mm");
  });

  it("falls back to <article> when there is no <main>", () => {
    const html = page("", `<div>Sidebar junk</div><article><p>The manual says 220 °C.</p></article>`);
    expect(extractPage(html, PAGE).text).toBe("The manual says 220 °C.");
  });

  it("uses the whole body when <main> is empty", () => {
    const html = page("", `<main></main><p>Body text</p>`);
    expect(extractPage(html, PAGE).text).toBe("Body text");
  });

  it("handles nested dropped elements of the same kind", () => {
    const html = page("", `<nav>a<nav>b</nav>c</nav><p>kept</p>`);
    expect(extractPage(html, PAGE).text).toBe("kept");
  });

  it("separates table cells and rows", () => {
    const html = page("", `<table><tr><th>Speed</th><td>500 mm/s</td></tr><tr><th>Bed</th><td>100 °C</td></tr></table>`);
    expect(extractPage(html, PAGE).text).toBe("Speed 500 mm/s\nBed 100 °C");
  });

  it("does not treat markup inside a script string as content", () => {
    const html = page("", `<script>document.write("<p>injected</p>")</script><p>real</p>`);
    expect(extractPage(html, PAGE).text).toBe("real");
  });

  it("ignores comments, doctype and CDATA", () => {
    const html = `<!DOCTYPE html><!-- <p>hidden</p> --><p>shown</p><![CDATA[ nope ]]>`;
    expect(extractPage(html, PAGE).text).toBe("shown");
  });

  it("survives broken markup without throwing", () => {
    expect(() => extractPage("<p>unclosed <b>bold <i attr='x>text", PAGE)).not.toThrow();
    expect(extractPage("a < b and c > d", PAGE).text).toBe("a < b and c > d");
    expect(extractPage("", PAGE)).toEqual({ title: null, text: "", images: [] });
  });

  it("returns a null title when there is none or it is blank", () => {
    expect(extractPage(page("<title>  </title>", "<p>x</p>"), PAGE).title).toBeNull();
  });
});

describe("extractPage — images", () => {
  it("takes og:image, then twitter:image, then JSON-LD, resolved against the page", () => {
    const html = page(
      `<meta name="twitter:image" content="/img/twitter.jpg">
       <meta property="og:image" content="https://cdn.maker.test/og.jpg">
       <script type="application/ld+json">{"@type":"Product","name":"P1S","image":"https://cdn.maker.test/ld.png"}</script>`,
      "<p>x</p>"
    );
    expect(extractPage(html, PAGE).images).toEqual([
      { url: "https://cdn.maker.test/og.jpg", source: "og", pageUrl: PAGE },
      { url: "https://maker.test/img/twitter.jpg", source: "twitter", pageUrl: PAGE },
      { url: "https://cdn.maker.test/ld.png", source: "jsonld", pageUrl: PAGE },
    ]);
  });

  it("reads og:image:secure_url and twitter:image:src, and decodes entities in the URL", () => {
    const html = page(
      `<meta property="og:image:secure_url" content="https://cdn.test/a.jpg?w=1&amp;h=2">
       <meta name="twitter:image:src" content='https://cdn.test/b.jpg'>`,
      ""
    );
    expect(extractPage(html, PAGE).images.map((i) => [i.source, i.url])).toEqual([
      ["og", "https://cdn.test/a.jpg?w=1&h=2"],
      ["twitter", "https://cdn.test/b.jpg"],
    ]);
  });

  it("de-duplicates across sources, keeping the first", () => {
    const html = page(
      `<meta property="og:image" content="https://cdn.test/same.jpg">
       <meta name="twitter:image" content="https://cdn.test/same.jpg">
       <script type="application/ld+json">{"@type":"Product","image":["https://cdn.test/same.jpg","https://cdn.test/other.jpg"]}</script>`,
      ""
    );
    expect(extractPage(html, PAGE).images.map((i) => [i.source, i.url])).toEqual([
      ["og", "https://cdn.test/same.jpg"],
      ["jsonld", "https://cdn.test/other.jpg"],
    ]);
  });

  it.each([
    ["a string", `{"@type":"Product","image":"/p.jpg"}`, ["https://maker.test/p.jpg"]],
    ["an array of strings", `{"@type":"Product","image":["/a.jpg","/b.jpg"]}`, ["https://maker.test/a.jpg", "https://maker.test/b.jpg"]],
    ["an ImageObject with url", `{"@type":"Product","image":{"@type":"ImageObject","url":"/io.jpg"}}`, ["https://maker.test/io.jpg"]],
    ["an ImageObject with contentUrl", `{"@type":"Product","image":{"@type":"ImageObject","contentUrl":"/c.jpg"}}`, ["https://maker.test/c.jpg"]],
    ["an array of ImageObjects", `{"@type":"Product","image":[{"url":"/1.jpg"},{"contentUrl":"/2.jpg"}]}`, ["https://maker.test/1.jpg", "https://maker.test/2.jpg"]],
    ["a top-level array of nodes", `[{"@type":"Organization","logo":"/logo.png"},{"@type":"Product","image":"/p.jpg"}]`, ["https://maker.test/p.jpg"]],
    [
      "an @graph",
      `{"@context":"https://schema.org","@graph":[{"@type":"WebPage","image":"/page.jpg"},{"@type":"Product","image":"/g.jpg"}]}`,
      ["https://maker.test/g.jpg"],
    ],
    ["an @type array", `{"@type":["Product","Thing"],"image":"/t.jpg"}`, ["https://maker.test/t.jpg"]],
    ["a namespaced @type", `{"@type":"http://schema.org/Product","image":"/ns.jpg"}`, ["https://maker.test/ns.jpg"]],
    ["a Product nested in another node", `{"@type":"ItemPage","mainEntity":{"@type":"Product","image":"/n.jpg"}}`, ["https://maker.test/n.jpg"]],
  ])("reads Product.image from %s", (_label, json, expected) => {
    const html = page(`<script type="application/ld+json">${json}</script>`, "");
    expect(extractPage(html, PAGE).images.map((i) => i.url)).toEqual(expected);
    expect(extractPage(html, PAGE).images.every((i) => i.source === "jsonld")).toBe(true);
  });

  it("ignores images on nodes that are not products, and malformed JSON-LD", () => {
    const html = page(
      `<script type="application/ld+json">{"@type":"Organization","image":"/org.jpg"}</script>
       <script type="application/ld+json">{ not json </script>
       <script type="application/ld+json"><!--{"@type":"Product","image":"/commented.jpg"}--></script>`,
      ""
    );
    expect(extractPage(html, PAGE).images.map((i) => i.url)).toEqual(["https://maker.test/commented.jpg"]);
  });

  it("drops non-http(s) image URLs", () => {
    const html = page(
      `<meta property="og:image" content="data:image/png;base64,AAAA">
       <meta property="og:image" content="javascript:alert(1)">
       <meta property="og:image" content="//cdn.test/proto-relative.jpg">`,
      ""
    );
    expect(extractPage(html, PAGE).images.map((i) => i.url)).toEqual(["https://cdn.test/proto-relative.jpg"]);
  });

  it("resolves against <base href> when the page sets one", () => {
    const html = page(`<base href="https://static.maker.test/assets/"><meta property="og:image" content="p.jpg">`, "");
    expect(extractPage(html, PAGE).images[0]).toEqual({
      url: "https://static.maker.test/assets/p.jpg",
      source: "og",
      pageUrl: PAGE,
    });
  });
});

describe("decodeEntities", () => {
  it("decodes named, decimal and hex references, and leaves unknown names alone", () => {
    expect(decodeEntities("&lt;b&gt; &quot;x&quot; &#39;y&#39; &#x2013; &euro;5 &bogus; &amp;amp;")).toBe(
      `<b> "x" 'y' – €5 &bogus; &amp;`
    );
  });

  it("replaces out-of-range code points rather than throwing", () => {
    expect(decodeEntities("&#x110000; &#xD800;")).toBe("� �");
  });
});

describe("extractPage — gallery images (amendment \"Composites and product crop\")", () => {
  const gallery = (html: string) =>
    extractPage(html, PAGE)
      .images.filter((i) => i.source === "gallery")
      .map((i) => i.url);

  it("takes each large <img> in the content at its largest srcset width, after the declared images", () => {
    const html = page(
      `<meta property="og:image" content="https://cdn.maker.test/og.jpg">`,
      `<main>
         <img src="/g/front.jpg?width=416" alt="front"
              srcset="/g/front.jpg?width=416 416w, /g/front.jpg?width=2400 2400w, /g/front.jpg?width=1200 1200w">
         <picture>
           <source type="image/webp" srcset="https://cdn.maker.test/side.webp 1x, https://cdn.maker.test/side@2x.webp 2x">
           <img src="https://cdn.maker.test/side.jpg" width="1080" height="1080">
         </picture>
       </main>`
    );
    const images = extractPage(html, PAGE).images;
    expect(images[0]).toEqual({ url: "https://cdn.maker.test/og.jpg", source: "og", pageUrl: PAGE });
    expect(gallery(html)).toEqual([
      "https://maker.test/g/front.jpg?width=2400",
      "https://cdn.maker.test/side@2x.webp",
      "https://cdn.maker.test/side.jpg",
    ]);
  });

  it("reads lazy-loading attributes and keeps a comma inside a srcset URL", () => {
    const html = page(
      "",
      `<main>
         <img data-src="/lazy.jpg" src="/placeholder.gif">
         <img data-srcset="https://res.test/image/upload/w_500,h_500/zoom.jpg 500w, https://res.test/image/upload/w_1600,h_1600/zoom.jpg 1600w">
         <img data-zoom-image="/zoom-big.jpg" src="/zoom-small.jpg">
       </main>`
    );
    expect(gallery(html)).toEqual([
      "https://maker.test/lazy.jpg",
      "https://res.test/image/upload/w_1600,h_1600/zoom.jpg",
      "https://maker.test/zoom-big.jpg",
    ]);
  });

  it("skips icons, logos, thumbnails, SVGs, GIFs, inline data, video sources and template errors", () => {
    const html = page(
      "",
      `<main>
         <img src="/brand-logo.png">
         <img src="/icons/cart-icon.png">
         <img src="/thumb.jpg" width="80" height="80">
         <img srcset="/t.jpg 54w, /t.jpg 180w">
         <img src="/diagram.svg">
         <img src="/spinner-anim.gif">
         <img src="data:image/png;base64,AAAA">
         <img src="Liquid error (sections/x line 474): invalid url input">
         <video><source src="/clip.mp4" type="video/mp4"></video>
         <img src="/product.jpg">
       </main>`
    );
    expect(gallery(html)).toEqual(["https://maker.test/product.jpg"]);
  });

  it("prefers the <main> content's pictures to the page chrome, and uses the body when there is no <main>", () => {
    const withMain = page("", `<div><img src="/promo-strip.jpg"></div><main><img src="/in-main.jpg"></main>`);
    expect(gallery(withMain)).toEqual(["https://maker.test/in-main.jpg"]);
    const noMain = page("", `<div><img src="/only.jpg"></div>`);
    expect(gallery(noMain)).toEqual(["https://maker.test/only.jpg"]);
    // Headers, navigation and footers are never content.
    expect(gallery(page("", `<header><img src="/hero-banner.jpg"></header><nav><img src="/menu.jpg"></nav>`))).toEqual([]);
  });

  it("drops a gallery picture that is a size variant of one already declared (Shopify)", () => {
    const html = page(
      `<meta property="og:image" content="http://www.shop.test/cdn/shop/files/air-1.jpg?v=17">
       <script type="application/ld+json">{"@type":"ProductGroup","hasVariant":[{"@type":"Product","image":"https://www.shop.test/cdn/shop/files/promo.jpg?v=9&width=1920"}]}</script>`,
      `<main>
         <img src="//www.shop.test/cdn/shop/files/air-1.jpg?v=17&amp;width=4472">
         <img src="//www.shop.test/cdn/shop/files/air-2_640x.jpg?v=17">
         <img src="//www.shop.test/cdn/shop/files/air-2_2048x2048.jpg?v=17">
         <img src="//www.shop.test/cdn/shop/files/promo.jpg?v=9&amp;width=800">
       </main>`
    );
    expect(extractPage(html, PAGE).images.map((i) => [i.source, i.url])).toEqual([
      // Upgraded: the page is https, so its http og:image is too.
      ["og", "https://www.shop.test/cdn/shop/files/air-1.jpg?v=17"],
      ["jsonld", "https://www.shop.test/cdn/shop/files/promo.jpg?v=9&width=1920"],
      ["gallery", "https://www.shop.test/cdn/shop/files/air-2_640x.jpg?v=17"],
    ]);
  });

  it("upgrades an http image on an https page, and leaves an http page's alone", () => {
    const html = page(`<meta property="og:image" content="http://cdn.maker.test/og.jpg">`, `<main><img src="http://cdn.maker.test/g.jpg"></main>`);
    expect(extractPage(html, PAGE).images.map((i) => i.url)).toEqual(["https://cdn.maker.test/og.jpg", "https://cdn.maker.test/g.jpg"]);
    expect(extractPage(html, "http://maker.test/p").images.map((i) => i.url)).toEqual(["http://cdn.maker.test/og.jpg", "http://cdn.maker.test/g.jpg"]);
  });

  it("takes at most a dozen gallery pictures from one page", () => {
    const imgs = Array.from({ length: 20 }, (_, i) => `<img src="/g/${i}.jpg">`).join("");
    expect(gallery(page("", `<main>${imgs}</main>`))).toHaveLength(12);
  });
});
