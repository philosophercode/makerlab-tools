import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEY, fromMm, loadSettings, sanitizeSettings, saveSettings, toMm, withSizeDefaults, type QrLabelSettings } from "./settings";

describe("label styler settings", () => {
  it("round-trips through storage", () => {
    const store = new Map<string, string>();
    const storage = { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => void store.set(key, value) };
    const settings = { ...DEFAULT_SETTINGS, preset: "custom" as const, unit: "mm" as const, style: { ...DEFAULT_SETTINGS.style, widthMm: 62, heightMm: 29, extraText: "Ask me" } };
    saveSettings(settings, storage);
    expect(JSON.parse(store.get(SETTINGS_STORAGE_KEY)!).style.widthMm).toBe(62);
    expect(loadSettings(storage)).toEqual(settings);
  });

  it("starts from the defaults when storage throws or holds junk", () => {
    const throwing = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(loadSettings(throwing)).toEqual(DEFAULT_SETTINGS);
    expect(() => saveSettings(DEFAULT_SETTINGS, throwing)).not.toThrow();
    expect(loadSettings({ getItem: () => "{not json" })).toEqual(DEFAULT_SETTINGS);
    expect(loadSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("clamps and repairs what it reads", () => {
    const repaired = sanitizeSettings({
      preset: "custom",
      unit: "cubits",
      style: { widthMm: 5000, heightMm: -3, showName: "yes", extraText: "x".repeat(200) },
      sheet: { paper: "tabloid", marginMm: 99, gapMm: -1, cutGuides: false },
    });
    expect(repaired.unit).toBe("in");
    expect(repaired.style.widthMm).toBe(200);
    expect(repaired.style.heightMm).toBe(15);
    expect(repaired.style.showName).toBe(true);
    expect(repaired.style.extraText).toHaveLength(60);
    expect(repaired.sheet).toEqual({ paper: "letter", marginMm: 40, gapMm: 0, cutGuides: false });
  });

  it("takes a preset's size from the preset, not from what was stored", () => {
    expect(sanitizeSettings({ preset: "3in", style: { widthMm: 10, heightMm: 10 } }).style.widthMm).toBe(76.2);
  });

  it("turns the logo and extra line off for a 1-inch label and a small custom one, not for the others", () => {
    const at = (preset: QrLabelSettings["preset"], widthMm: number, heightMm = widthMm) =>
      withSizeDefaults({ ...DEFAULT_SETTINGS, preset, style: { ...DEFAULT_SETTINGS.style, widthMm, heightMm } }).style;
    expect(at("1in", 25.4)).toMatchObject({ showBrand: false, showExtra: false, extraText: "Scan for manual & help" });
    expect(at("custom", 32)).toMatchObject({ showBrand: false, showExtra: false });
    expect(at("custom", 70)).toMatchObject({ showBrand: true, showExtra: true });
    expect(at("2in", 50.8)).toMatchObject({ showBrand: true, showExtra: true });
  });

  it("keeps a stored extra line switched off", () => {
    expect(sanitizeSettings({ style: { showExtra: false } }).style.showExtra).toBe(false);
    expect(sanitizeSettings({}).style.showExtra).toBe(true);
  });

  it("converts between inches and millimetres", () => {
    expect(toMm(2, "in")).toBeCloseTo(50.8, 9);
    expect(fromMm(50.8, "in")).toBe(2);
    expect(fromMm(50.8, "mm")).toBe(50.8);
  });
});
