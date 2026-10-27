import type { LabConfig } from "./schema.ts";

/**
 * Types `lab/lab.config.ts` (lab config spec 2026-10-25 §4): an identity
 * function, so the file gets autocompletion and a type error per wrong field
 * without the app importing zod. `npm run lab:check` checks the values.
 */
export function defineLab(config: LabConfig): LabConfig {
  return config;
}

export type { LabConfig, LocalizedText } from "./schema.ts";
