import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Config for `npm run eval` only — **not** part of `npm test`.
 *
 * Vitest is used here purely as a TypeScript task runner so the harness can
 * import the app's real modules (`@/` alias, `server-only` stub, TS transform).
 * Two deliberate differences from the main `vitest.config.ts`:
 *
 *  - **No `setupFiles`.** The shared setup starts MSW with
 *    `onUnhandledRequest: "error"`, which would block the real Anthropic call
 *    this suite exists to make.
 *  - **`include` is the single eval entrypoint**, which the main config never
 *    picks up (it is not a `*.test.ts`), so the eval suite can never sneak into
 *    `npm run test:all`.
 */
export default defineConfig({
  root: r(".."),
  resolve: {
    alias: {
      "@": r("../src"),
      "server-only": r("../test/mocks/server-only.ts"),
    },
  },
  test: {
    globals: true,
    environment: "node",
    include: ["evals/run.eval.ts"],
    // Real model calls, ~12 cases, sequential, with one retry each.
    testTimeout: 900_000,
    hookTimeout: 60_000,
  },
});
