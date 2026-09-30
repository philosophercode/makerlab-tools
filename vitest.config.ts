import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * Two projects, one command (`npx vitest run` runs both).
 *
 * - **unit** — everything the suite has always been: jsdom by default, MSW on,
 *   PGlite behind `// @vitest-environment node`. Unchanged except that it
 *   leaves `*.workflow.test.ts` to the second project.
 * - **workflow** — `vitest.workflow.config.ts`: `@workflow/vitest`, which runs
 *   `researchBatch` in process against a local world. Its own file because the
 *   plugin compiles and loads step code outside Vite's module graph, so it
 *   must not touch the tests that rely on `vi.mock` (2026-09-22 amendment).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // `@/foo` → `src/foo` (matches tsconfig paths).
      "@": r("./src"),
      // `import "server-only"` throws outside a server runtime; swap it for an
      // empty module so rate-limit.ts and its importers load under Vitest.
      "server-only": r("./test/mocks/server-only.ts"),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      // Reporters only — no thresholds, no gate.
      reporter: ["text", "html"],
      exclude: ["e2e/**", "test/**", "**/*.config.*", "**/*.d.ts"],
    },
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          // describe/it/expect/vi available without imports.
          globals: true,
          environment: "jsdom",
          setupFiles: ["./vitest.setup.ts"],
          // Playwright specs live in e2e/ and must not be collected by Vitest;
          // workflow tests belong to the workflow project.
          exclude: ["**/node_modules/**", "**/dist/**", "e2e/**", "**/*.workflow.test.ts"],
        },
      },
      "./vitest.workflow.config.ts",
    ],
  },
});
