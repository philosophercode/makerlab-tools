// Stub for the `server-only` package.
//
// `src/lib/rate-limit.ts` (and any module that transitively imports it) does
// `import "server-only"`, whose real implementation throws when evaluated
// outside a React Server Component / Next build. Vitest aliases `server-only`
// to this empty module (see vitest.config.ts) so those modules import cleanly
// in the test environment.
export {};
