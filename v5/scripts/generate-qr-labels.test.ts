import { resolve } from "node:path";
import {
  buildLabelSheet,
  DEFAULT_QR_MM,
  deriveLabels,
  formatLabelLocation,
  loadSheetStrings,
  MIN_QR_MM,
  parseArgs,
  pickSheetStrings,
  renderLabelSheet,
  toolPageUrl,
  type LabelSheetStrings,
  type QrLabelSource,
} from "./generate-qr-labels.ts";
import { mockTools } from "@/components/mock-catalog";
import enMessages from "../messages/en.json";

const MESSAGES_DIR = resolve(process.cwd(), "messages");

const BASE = "https://tools.example.edu";

const STRINGS: LabelSheetStrings = {
  sheetTitle: "QR labels",
  sheetSubtitle: "Print on sticker stock.",
  labelCta: "Scan for help",
  sheetEmpty: "No published tools to label.",
};

// Deterministic stand-in for the `qrcode` encoder — the real one is a
// devDependency doing local CPU work; the tests care about label data and
// sheet structure, not about pixel-for-pixel QR output.
const fakeEncoder = async (url: string) => `<svg data-url="${url}"></svg>`;

function source(overrides: Partial<QrLabelSource> = {}): QrLabelSource {
  return {
    id: "tool-form-4",
    slug: "form-4",
    name: "Form 4",
    location: "MakerLab",
    zone: "Resin Bench",
    ...overrides,
  };
}

describe("toolPageUrl", () => {
  it("encodes the real tool page with the ?src=qr marker", () => {
    expect(toolPageUrl(BASE, "form-4")).toBe(
      "https://tools.example.edu/tools/form-4?src=qr"
    );
  });

  it("tolerates a trailing slash on the site URL", () => {
    expect(toolPageUrl("https://tools.example.edu/", "form-4")).toBe(
      "https://tools.example.edu/tools/form-4?src=qr"
    );
  });

  it("escapes a slug that is not URL-safe", () => {
    expect(toolPageUrl(BASE, "a b/c")).toBe(
      "https://tools.example.edu/tools/a%20b%2Fc?src=qr"
    );
  });
});

describe("formatLabelLocation", () => {
  it("joins room and zone", () => {
    expect(formatLabelLocation(source())).toBe("MakerLab / Resin Bench");
  });

  it("degrades to an empty string when the catalog has no location", () => {
    expect(formatLabelLocation(source({ location: null, zone: undefined }))).toBe("");
  });

  it("keeps the single value when only one of room/zone is set", () => {
    expect(formatLabelLocation(source({ zone: "  " }))).toBe("MakerLab");
  });

  it("collapses a duplicated room/zone sentinel", () => {
    expect(formatLabelLocation(source({ location: "Unknown", zone: "Unknown" }))).toBe(
      "Unknown"
    );
  });
});

describe("deriveLabels", () => {
  it("derives name, location, and URL for a tool", () => {
    expect(deriveLabels([source()], BASE)).toEqual([
      {
        id: "tool-form-4",
        name: "Form 4",
        location: "MakerLab / Resin Bench",
        url: "https://tools.example.edu/tools/form-4?src=qr",
      },
    ]);
  });

  it("does not throw on a tool with no location — it just omits it", () => {
    const [label] = deriveLabels([source({ location: null, zone: null })], BASE);
    expect(label.location).toBe("");
    expect(label.url).toBe("https://tools.example.edu/tools/form-4?src=qr");
  });

  it("excludes unpublished tools", () => {
    const labels = deriveLabels(
      [source({ published: true }), source({ id: "draft", slug: "draft", published: false })],
      BASE
    );
    expect(labels.map((label) => label.id)).toEqual(["tool-form-4"]);
  });

  it("treats an absent published flag as published", () => {
    expect(deriveLabels([source()], BASE)).toHaveLength(1);
  });

  it("skips a record with no routing key rather than printing a dead code", () => {
    expect(deriveLabels([source({ id: "", slug: "" })], BASE)).toEqual([]);
  });

  it("falls back to the id when there is no slug", () => {
    const [label] = deriveLabels([source({ slug: undefined })], BASE);
    expect(label.url).toBe("https://tools.example.edu/tools/tool-form-4?src=qr");
  });
});

describe("renderLabelSheet", () => {
  it("escapes label text so a quote in a machine name cannot break the sheet", () => {
    const html = renderLabelSheet(
      [
        {
          id: "t",
          name: 'Saw "Big" <b>',
          location: "Shop & Bench",
          url: `${BASE}/tools/t?src=qr`,
          svg: "<svg></svg>",
        },
      ],
      STRINGS
    );
    expect(html).toContain("Saw &quot;Big&quot; &lt;b&gt;");
    expect(html).toContain("Shop &amp; Bench");
  });

  it("omits the location line entirely when there is none", () => {
    const html = renderLabelSheet(
      [{ id: "t", name: "Saw", location: "", url: `${BASE}/t`, svg: "<svg></svg>" }],
      STRINGS
    );
    expect(html).not.toContain('class="qr-location"');
    expect(html).toContain("Saw");
  });

  it("renders the empty state when there is nothing to label", () => {
    const html = renderLabelSheet([], STRINGS);
    expect(html).toContain(STRINGS.sheetEmpty);
    expect(html).not.toContain('class="qr-label"');
  });

  it("sets lang and dir from the locale", () => {
    expect(renderLabelSheet([], STRINGS, { locale: "ar" })).toContain('lang="ar" dir="rtl"');
    expect(renderLabelSheet([], STRINGS, { locale: "en" })).toContain('lang="en" dir="ltr"');
  });

  it("sizes the code from qrMm and never below the 25mm floor", () => {
    expect(renderLabelSheet([], STRINGS, { qrMm: 45 })).toContain("width: 45mm");
    // 10mm would not survive a wipe-down; the floor wins.
    expect(renderLabelSheet([], STRINGS, { qrMm: 10 })).toContain(`width: ${MIN_QR_MM}mm`);
  });

  it("defaults to a code comfortably above the minimum", () => {
    expect(DEFAULT_QR_MM).toBeGreaterThanOrEqual(MIN_QR_MM);
    expect(renderLabelSheet([], STRINGS)).toContain(`width: ${DEFAULT_QR_MM}mm`);
  });
});

describe("buildLabelSheet (integration, mock catalog)", () => {
  it("produces one label per tool in the mock catalog", async () => {
    const html = await buildLabelSheet(mockTools, {
      baseUrl: BASE,
      strings: STRINGS,
      encodeQr: fakeEncoder,
    });

    const labels = html.match(/class="qr-label"/g) || [];
    expect(labels).toHaveLength(mockTools.length);
    expect(mockTools.length).toBeGreaterThan(0);
  });

  it("encodes each tool's own ?src=qr URL and prints its name", async () => {
    const html = await buildLabelSheet(mockTools, {
      baseUrl: BASE,
      strings: STRINGS,
      encodeQr: fakeEncoder,
    });

    for (const tool of mockTools) {
      expect(html).toContain(`${BASE}/tools/${tool.slug}?src=qr`);
      expect(html).toContain(tool.name);
    }
    expect(html).toContain(STRINGS.labelCta);
  });

  it("drops unpublished tools from the sheet", async () => {
    const html = await buildLabelSheet(
      [...mockTools.map((tool) => ({ ...tool, published: false })), source()],
      { baseUrl: BASE, strings: STRINGS, encodeQr: fakeEncoder }
    );

    expect(html.match(/class="qr-label"/g) || []).toHaveLength(1);
    expect(html).toContain("Form 4");
  });
});

describe("sheet strings", () => {
  it("picks the qr namespace out of a locale catalog", () => {
    const strings = pickSheetStrings(enMessages);
    expect(strings.labelCta).toBe(enMessages.qr.labelCta);
    expect(strings.sheetTitle).toBe(enMessages.qr.sheetTitle);
  });

  it("falls back rather than printing an empty sheet when a namespace is missing", () => {
    const strings = pickSheetStrings({});
    expect(strings.labelCta.length).toBeGreaterThan(0);
    expect(strings.sheetTitle.length).toBeGreaterThan(0);
  });

  it("reads a non-English locale from disk", async () => {
    const strings = await loadSheetStrings("fr", MESSAGES_DIR);
    expect(strings.labelCta).toBe("Scannez pour obtenir de l'aide");
  });
});

describe("parseArgs", () => {
  it("reads --base-url in both spaced and = forms", () => {
    expect(parseArgs(["--base-url", BASE]).baseUrl).toBe(BASE);
    expect(parseArgs([`--base-url=${BASE}`]).baseUrl).toBe(BASE);
  });

  it("falls back to NEXT_PUBLIC_SITE_URL", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", BASE);
    expect(parseArgs([]).baseUrl).toBe(BASE);
  });

  it("returns a null base URL when nothing supplies one", () => {
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    vi.stubEnv("QR_LABEL_BASE_URL", "");
    expect(parseArgs([]).baseUrl).toBeNull();
  });

  it("defaults the locale and output path, and rejects an unsupported locale", () => {
    expect(parseArgs([]).locale).toBe("en");
    expect(parseArgs([]).out).toBe("qr-labels.html");
    expect(parseArgs(["--locale", "xx"]).locale).toBe("en");
    expect(parseArgs(["--locale", "ja"]).locale).toBe("ja");
  });

  it("clamps --qr-mm to the readable minimum and ignores junk", () => {
    expect(parseArgs(["--qr-mm", "45"]).qrMm).toBe(45);
    expect(parseArgs(["--qr-mm", "10"]).qrMm).toBe(MIN_QR_MM);
    expect(parseArgs(["--qr-mm", "huge"]).qrMm).toBe(DEFAULT_QR_MM);
    expect(parseArgs([]).qrMm).toBe(DEFAULT_QR_MM);
  });
});

describe("encodeQrSvg (the real encoder)", () => {
  it("emits SVG at error-correction level H", async () => {
    const { encodeQrSvg } = await import("./generate-qr-labels.ts");
    const svg = await encodeQrSvg(`${BASE}/tools/form-4?src=qr`);
    expect(svg.startsWith("<svg")).toBe(true);

    // Level H produces a denser symbol than the default level M for the same
    // payload — assert on the module count rather than trusting the option.
    const { toString: toQrString } = await import("qrcode");
    const defaultSvg = await toQrString(`${BASE}/tools/form-4?src=qr`, {
      type: "svg",
      margin: 4,
    });
    const modules = (svg.match(/viewBox="0 0 (\d+)/) || [])[1];
    const defaultModules = (defaultSvg.match(/viewBox="0 0 (\d+)/) || [])[1];
    expect(Number(modules)).toBeGreaterThan(Number(defaultModules));
  });
});
