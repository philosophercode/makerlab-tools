import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

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
    // describe/it/expect/vi available without imports.
    globals: true,
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    // Playwright specs live in e2e/ and must not be collected by Vitest.
    exclude: ["**/node_modules/**", "**/dist/**", "e2e/**"],
    coverage: {
      provider: "v8",
      // Reporters only — no thresholds, no gate.
      reporter: ["text", "html"],
      exclude: ["e2e/**", "test/**", "**/*.config.*", "**/*.d.ts"],
    },
  },
});
