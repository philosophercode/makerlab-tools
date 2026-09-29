import {
  DEFAULT_LABEL_STYLE,
  DEFAULT_SHEET,
  EXTRA_TEXT_MAX,
  LABEL_MAX_MM,
  LABEL_MIN_MM,
  LABEL_PRESETS,
  PAPER_IDS,
  SHEET_GAP_MAX_MM,
  SHEET_MARGIN_MAX_MM,
  type LabelPresetId,
  type LabelStyle,
  type PaperId,
  type SheetSetup,
} from "./label-layout.ts";

/**
 * The label styler's settings, remembered per browser (`localStorage`, every
 * read and write in try/catch — a private window or blocked storage just
 * starts from the defaults). Nothing here reaches the server: a style is a
 * printing preference, not a record, so it needs no table.
 */

export type SizeUnit = "in" | "mm";

export interface QrLabelSettings {
  /** A preset, or `custom` for the width and height in `style`. */
  preset: LabelPresetId | "custom";
  /** How the custom size is typed. */
  unit: SizeUnit;
  style: LabelStyle;
  sheet: SheetSetup;
}

export const DEFAULT_SETTINGS: QrLabelSettings = {
  preset: "2in",
  unit: "in",
  style: DEFAULT_LABEL_STYLE,
  sheet: DEFAULT_SHEET,
};

export const SETTINGS_STORAGE_KEY = "makerlab.qr-labels.v1";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) ? clamp(value, min, max) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

/** Anything (a stored value from an older version, a hand-edited one) into valid settings. */
export function sanitizeSettings(raw: unknown): QrLabelSettings {
  if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
  const value = raw as Partial<Record<keyof QrLabelSettings, unknown>>;
  const style = (value.style && typeof value.style === "object" ? value.style : {}) as Partial<Record<keyof LabelStyle, unknown>>;
  const sheet = (value.sheet && typeof value.sheet === "object" ? value.sheet : {}) as Partial<Record<keyof SheetSetup, unknown>>;
  const presetIds = LABEL_PRESETS.map((entry) => entry.id as string);
  const preset = typeof value.preset === "string" && (presetIds.includes(value.preset) || value.preset === "custom") ? (value.preset as QrLabelSettings["preset"]) : DEFAULT_SETTINGS.preset;
  const presetSize = LABEL_PRESETS.find((entry) => entry.id === preset);
  return {
    preset,
    unit: value.unit === "mm" ? "mm" : "in",
    style: {
      widthMm: presetSize ? presetSize.widthMm : num(style.widthMm, DEFAULT_LABEL_STYLE.widthMm, LABEL_MIN_MM, LABEL_MAX_MM),
      heightMm: presetSize ? presetSize.heightMm : num(style.heightMm, DEFAULT_LABEL_STYLE.heightMm, LABEL_MIN_MM, LABEL_MAX_MM),
      showName: bool(style.showName, DEFAULT_LABEL_STYLE.showName),
      showLocation: bool(style.showLocation, DEFAULT_LABEL_STYLE.showLocation),
      extraText: typeof style.extraText === "string" ? style.extraText.slice(0, EXTRA_TEXT_MAX) : DEFAULT_LABEL_STYLE.extraText,
      showBrand: bool(style.showBrand, DEFAULT_LABEL_STYLE.showBrand),
      showUrl: bool(style.showUrl, DEFAULT_LABEL_STYLE.showUrl),
    },
    sheet: {
      paper: typeof sheet.paper === "string" && (PAPER_IDS as readonly string[]).includes(sheet.paper) ? (sheet.paper as PaperId) : DEFAULT_SHEET.paper,
      marginMm: num(sheet.marginMm, DEFAULT_SHEET.marginMm, 0, SHEET_MARGIN_MAX_MM),
      gapMm: num(sheet.gapMm, DEFAULT_SHEET.gapMm, 0, SHEET_GAP_MAX_MM),
      cutGuides: bool(sheet.cutGuides, DEFAULT_SHEET.cutGuides),
    },
  };
}

export function loadSettings(storage: Pick<Storage, "getItem"> | null | undefined = safeStorage()): QrLabelSettings {
  try {
    const raw = storage?.getItem(SETTINGS_STORAGE_KEY);
    return raw ? sanitizeSettings(JSON.parse(raw)) : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: QrLabelSettings, storage: Pick<Storage, "setItem"> | null | undefined = safeStorage()): void {
  try {
    storage?.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Full, blocked or private: the page still works, it just forgets.
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Millimetres as the unit the person types in, to a sensible precision. */
export function fromMm(mm: number, unit: SizeUnit): number {
  return unit === "in" ? Math.round((mm / 25.4) * 100) / 100 : Math.round(mm * 10) / 10;
}

export function toMm(value: number, unit: SizeUnit): number {
  return unit === "in" ? value * 25.4 : value;
}
