import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Config for `npm run eval:photo-options` only, never part of `npm test`.
 * The same shape as `evals/vitest.config.ts`: the `@/` alias, `server-only`
 * and `next/cache` stubbed, no setup file (it would start MSW and block the
 * real Gateway), and the one eval file as the only entry.
 */
export default defineConfig({
  root: r(".."),
  resolve: {
    alias: {
      "@": r("../src"),
      "server-only": r("../test/mocks/server-only.ts"),
      "next/cache": r("../test/mocks/next-cache-noop.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["evals/photo-options.eval.ts"],
    // Twelve tools, one at a time: a search, a ranking and four judged pictures each.
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 60_000,
    disableConsoleIntercept: true,
  },
});
