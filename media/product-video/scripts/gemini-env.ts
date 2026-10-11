import { readFileSync } from "node:fs";

/**
 * GEMINI_API_KEY from the environment, or else from an env file named by
 * GEMINI_ENV_FILE (default: the repo root's .env.local). Never printed.
 */
export function geminiKey(): string {
  if (process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  const file = process.env.GEMINI_ENV_FILE ?? new URL("../../../.env.local", import.meta.url).pathname;
  const line = readFileSync(file, "utf8")
    .split("\n")
    .reverse()
    .find((l) => /^\s*GEMINI_API_KEY\s*=/.test(l));
  const value = line?.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`GEMINI_API_KEY not set and not found in ${file}`);
  return value;
}
