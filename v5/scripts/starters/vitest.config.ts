import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Config for `npm run starters:refresh` only — never part of `npm test`.
 * Vitest as a TypeScript task runner, exactly as `evals/vitest.config.ts`:
 * the `@/` alias, `server-only` and `next/cache` stubbed (the catalogue's
 * `"use cache"` reads call `cacheTag`, which throws outside a Next build), no
 * setup file (it would start MSW and block the real Gateway), and the one
 * task file as the only entry.
 */
export default defineConfig({
  root: r("../.."),
  resolve: {
    alias: {
      "@": r("../../src"),
      "server-only": r("../../test/mocks/server-only.ts"),
      "next/cache": r("../../test/mocks/next-cache-noop.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["scripts/starters/refresh.task.ts"],
    // A full inventory is hundreds of chat turns.
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 60_000,
    // Progress lines as they happen, not buffered per test.
    disableConsoleIntercept: true,
    reporters: ["dot"],
  },
});
