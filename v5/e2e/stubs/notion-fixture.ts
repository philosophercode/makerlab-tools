/**
 * The Notion workspace the mirror E2E connects to (data platform spec §10, E2E
 * scenario 8).
 *
 * Shared by the spec, by `notion-stub.ts` and by `playwright.config.ts`, so
 * the token the test types is the token the stub accepts and the page it
 * pastes is the page the stub has. No imports: the stub runs under plain Node.
 *
 * **Nothing here is a real credential.** The token is shaped like one so the
 * app's validation accepts it, and it is accepted by nothing but the stub on
 * this machine.
 */

/** The port the stub listens on. The app reaches it through `NOTION_API_BASE_URL`. */
export const NOTION_STUB_PORT = 3102;

export const NOTION_STUB_ORIGIN = `http://localhost:${NOTION_STUB_PORT}`;

/** An internal-integration token as Notion shapes them. Fake. */
export const NOTION_STUB_TOKEN = "ntn_e2eStubTokenNotReal0000000000";

/** The page the admin "shared with the integration" (§4.14). */
export const NOTION_STUB_PAGE_ID = "5e2e0c7a-3b1d-4f6a-9c8e-0d1f2a3b4c5d";

export const NOTION_STUB_PAGE_TITLE = "MakerLab Tools — mirror";

/** The page as an admin pastes it: the browser's address bar, slug and all. */
export const NOTION_STUB_PAGE_URL = `https://www.notion.so/makerlab/MakerLab-Tools-mirror-${NOTION_STUB_PAGE_ID.replace(
  /-/g,
  ""
)}?pvs=4`;
