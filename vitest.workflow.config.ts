import { fileURLToPath } from "node:url";
import { workflow } from "@workflow/vitest";
import { defineProject } from "vitest/config";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

/**
 * The in-process Workflow SDK tier (spec §10: "one in-process `@workflow/vitest`
 * test of `researchBatch`"). Only `src/**\/*.workflow.test.ts` runs here.
 *
 * What the plugin does, and what that means for a test written against it:
 *
 * - **It builds bundles first.** A global setup scans the project root for
 *   files with `"use workflow"` / `"use step"` and writes `workflows.mjs` and
 *   `steps.mjs` to `.workflow-vitest/`; runs are recorded under
 *   `.workflow-data/`. Both are git-ignored.
 * - **Step code runs from that bundle, through Node's native `import()`,
 *   outside Vite's module graph.** So `vi.mock()` does not reach it, and
 *   neither do this config's aliases — the step bundle inlines project files
 *   itself and leaves packages external. A model call inside a step is stubbed
 *   with MSW on the Vercel AI Gateway's endpoint
 *   (`https://ai-gateway.vercel.sh/v3/ai`, the provider's default base), in the
 *   Gateway's own wire format — `gatewayHandlers` from `test/gateway/msw.ts`
 *   with the builders in `test/gateway/wire.ts`; MSW does reach step code. A
 *   test stubs `AI_GATEWAY_API_KEY` with any value so the provider can build
 *   its headers. Host names resolve through `test/web/resolver.ts`, which lives
 *   on `globalThis` so the step bundle's copy of the page reader sees it.
 * - **A step must not import `server-only`**, directly or transitively: the
 *   bundle loads packages from `node_modules` at runtime, where that package
 *   throws outside a React server build.
 *
 * The same aliases and `vitest.setup.ts` as the unit project, so MSW runs with
 * `onUnhandledRequest: "error"` here too and no test reaches the network.
 */
export default defineProject({
  plugins: [workflow()],
  resolve: {
    alias: {
      "@": r("./src"),
      "server-only": r("./test/mocks/server-only.ts"),
    },
  },
  test: {
    name: "workflow",
    globals: true,
    environment: "node",
    include: ["src/**/*.workflow.test.ts"],
    setupFiles: ["./vitest.setup.ts"],
  },
});
