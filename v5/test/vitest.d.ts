// Makes Vitest's globals (describe/it/expect/vi/beforeAll/...) and the
// jest-dom matchers available to TypeScript everywhere, since the harness runs
// with `test.globals: true` (see vitest.config.ts). Picked up by the root
// tsconfig's `**/*.ts` include so `tsc --noEmit` typechecks test files too.
/// <reference types="vitest/globals" />
/// <reference types="@testing-library/jest-dom" />
