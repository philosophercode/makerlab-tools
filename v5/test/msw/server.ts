import { setupServer } from "msw/node";
import { handlers } from "./handlers";

// The shared MSW node server. Lifecycle (listen/resetHandlers/close) is wired in
// vitest.setup.ts. Tests override defaults per-test with `server.use(...)`;
// overrides are dropped after each test by the `afterEach(resetHandlers)` hook.
export const server = setupServer(...handlers);
