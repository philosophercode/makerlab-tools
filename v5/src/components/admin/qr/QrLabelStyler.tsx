"use client";

import { useId } from "react";
import { useTranslations } from "next-intl";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Button } from "@/components/ui/button";
import { Field } from "../../system/Field";
import {
  EXTRA_TEXT_MAX,
  LABEL_MAX_MM,
  LABEL_MIN_MM,
  LABEL_PRESETS,
  PAPER_IDS,
  SHEET_GAP_MAX_MM,
  SHEET_MARGIN_MAX_MM,
  type LabelStyle,
  type PaperId,
  type SheetSetup,
} from "../../../lib/qr/label-layout";
import { DEFAULT_SETTINGS, fromMm, toMm, withSizeDefaults, type QrLabelSettings, type SizeUnit } from "../../../lib/qr/settings";

/**
 * The label styler: size (four square presets, or a custom width and height
 * in inches or millimetres), what the label says, and the page it prints on.
 * Every change is the caller's settings object, which the page remembers per
 * browser and the preview redraws from at once.
 */
export function QrLabelStyler({ settings, onChange }: { settings: QrLabelSettings; onChange: (next: QrLabelSettings) => void }) {
  const t = useTranslations("admin.qrLabels");
  const id = useId();
  const { style, sheet, unit } = settings;

  const setStyle = (patch: Partial<LabelStyle>) => onChange({ ...settings, style: { ...style, ...patch } });
  const setSheet = (patch: Partial<SheetSetup>) => onChange({ ...settings, sheet: { ...sheet, ...patch } });

  function choosePreset(value: string) {
    const preset = LABEL_PRESETS.find((entry) => entry.id === value);
    // A new size brings its defaults: a small code gets the room (`withSizeDefaults`).
    if (preset) onChange(withSizeDefaults({ ...settings, preset: preset.id, style: { ...style, widthMm: preset.widthMm, heightMm: preset.heightMm } }));
    else onChange(withSizeDefaults({ ...settings, preset: "custom" }));
  }

  function setDimension(key: "widthMm" | "heightMm", raw: string) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return;
    const mm = Math.min(LABEL_MAX_MM, Math.max(LABEL_MIN_MM, toMm(value, unit)));
    if (mm === style[key]) return;
    onChange(withSizeDefaults({ ...settings, style: { ...style, [key]: mm } }));
  }

  const step = unit === "in" ? 0.125 : 1;
  const toggles: { key: "showName" | "showLocation" | "showBrand" | "showUrl" | "showExtra"; label: string }[] = [
    { key: "showName", label: t("showName") },
    { key: "showLocation", label: t("showLocation") },
    { key: "showBrand", label: t("showBrand") },
    { key: "showUrl", label: t("showUrl") },
    { key: "showExtra", label: t("showExtra") },
  ];

  return (
    <div className="flex flex-col gap-5">
      <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0 gap-3">
        <legend className="mb-2 p-0 font-mono text-label tracking-[0.08em] uppercase">{t("sizeHeading")}</legend>
        {/* A row of pressed/unpressed buttons: SegmentedControl is sized for icons, and these are words. */}
        <div role="group" aria-label={t("sizeLabel")} className="flex flex-wrap gap-1">
          {[...LABEL_PRESETS.map((preset) => preset.id as string), "custom"].map((value) => (
            <Button
              key={value}
              size="sm"
              variant={settings.preset === value ? "default" : "quiet"}
              aria-pressed={settings.preset === value}
              aria-label={t(`preset.${presetKey(value)}` as "preset.custom")}
              onClick={() => choosePreset(value)}
            >
              {t(`presetShort.${presetKey(value)}` as "presetShort.custom")}
            </Button>
          ))}
        </div>
        {settings.preset === "custom" ? (
          <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
            <Field id={`${id}-w`} label={t("width")}>
              <Input
                id={`${id}-w`}
                type="number"
                inputMode="decimal"
                min={fromMm(LABEL_MIN_MM, unit)}
                max={fromMm(LABEL_MAX_MM, unit)}
                step={step}
                // Keyed by unit and value, so switching units redraws the number.
                key={`w-${unit}-${style.widthMm}`}
                defaultValue={fromMm(style.widthMm, unit)}
                onBlur={(event) => setDimension("widthMm", event.target.value)}
              />
            </Field>
            <Field id={`${id}-h`} label={t("height")}>
              <Input
                id={`${id}-h`}
                type="number"
                inputMode="decimal"
                min={fromMm(LABEL_MIN_MM, unit)}
                max={fromMm(LABEL_MAX_MM, unit)}
                step={step}
                key={`h-${unit}-${style.heightMm}`}
                defaultValue={fromMm(style.heightMm, unit)}
                onBlur={(event) => setDimension("heightMm", event.target.value)}
              />
            </Field>
            <Field id={`${id}-unit`} label={t("unit")}>
              <NativeSelect id={`${id}-unit`} value={unit} onChange={(event) => onChange({ ...settings, unit: event.target.value as SizeUnit })}>
                <option value="in">{t("unitIn")}</option>
                <option value="mm">{t("unitMm")}</option>
              </NativeSelect>
            </Field>
          </div>
        ) : null}
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0 gap-2">
        <legend className="mb-2 p-0 font-mono text-label tracking-[0.08em] uppercase">{t("contentHeading")}</legend>
        {toggles.map((toggle) => (
          <label key={toggle.key} className="flex items-center gap-2 text-sm">
            <Checkbox checked={style[toggle.key]} onCheckedChange={(checked) => setStyle({ [toggle.key]: checked === true })} />
            {toggle.label}
          </label>
        ))}
        <Field id={`${id}-extra`} label={t("extraText")} hint={t("extraTextHint")} className="pt-1">
          <Input
            id={`${id}-extra`}
            value={style.extraText}
            disabled={!style.showExtra}
            maxLength={EXTRA_TEXT_MAX}
            placeholder={t("extraTextPlaceholder")}
            onChange={(event) => setStyle({ extraText: event.target.value })}
          />
        </Field>
      </fieldset>

      <fieldset className="m-0 flex min-w-0 flex-col border-0 p-0 gap-3">
        <legend className="mb-2 p-0 font-mono text-label tracking-[0.08em] uppercase">{t("pageHeading")}</legend>
        <Field id={`${id}-paper`} label={t("paper")}>
          <NativeSelect id={`${id}-paper`} value={sheet.paper} onChange={(event) => setSheet({ paper: event.target.value as PaperId })} className="w-full">
            {PAPER_IDS.map((paper) => (
              <option key={paper} value={paper}>
                {t(`paperOption.${paper}`)}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {sheet.paper !== "label" ? (
          <>
            <div className="grid grid-cols-2 gap-2">
              <Field id={`${id}-margin`} label={t("margin")}>
                <Input
                  id={`${id}-margin`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={SHEET_MARGIN_MAX_MM}
                  step={1}
                  value={sheet.marginMm}
                  onChange={(event) => setSheet({ marginMm: clampNumber(event.target.value, SHEET_MARGIN_MAX_MM, sheet.marginMm) })}
                />
              </Field>
              <Field id={`${id}-gap`} label={t("gap")}>
                <Input
                  id={`${id}-gap`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  max={SHEET_GAP_MAX_MM}
                  step={1}
                  value={sheet.gapMm}
                  onChange={(event) => setSheet({ gapMm: clampNumber(event.target.value, SHEET_GAP_MAX_MM, sheet.gapMm) })}
                />
              </Field>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={sheet.cutGuides} onCheckedChange={(checked) => setSheet({ cutGuides: checked === true })} />
              {t("cutGuides")}
            </label>
          </>
        ) : (
          <p className="text-xs text-muted-foreground">{t("labelPaperHint")}</p>
        )}
      </fieldset>

      <Button variant="ghost" size="sm" className="self-start" onClick={() => onChange(DEFAULT_SETTINGS)}>
        {t("reset")}
      </Button>
    </div>
  );
}

/** `1.5in` → `1_5in`: a next-intl key cannot hold a dot. */
export function presetKey(id: string): string {
  return id.replace(/\./g, "_");
}

function clampNumber(raw: string, max: number, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(max, Math.max(0, value)) : fallback;
}
