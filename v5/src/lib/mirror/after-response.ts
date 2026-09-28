import { after } from "next/server";
import { requestMirrorPush } from "./trigger";

/**
 * Tell the Notion mirror a change landed — **after the response is sent**
 * (performance plan, "Make a tool-editor save a single round trip"). Every
 * editor save waited on `requestMirrorPush()` (a claim query, sometimes a
 * workflow start) before answering, for something nobody sees for two
 * minutes. `after()` runs it once the answer is on its way.
 *
 * Outside a Next request (a test, a script, the CLI) `after` is unavailable;
 * the push then runs straight away and the returned promise is that push, so
 * a caller that awaits it keeps the process (or a frozen serverless function)
 * alive until the claim is taken and released. Inside a request it resolves at
 * once. It never rejects either way.
 */
export function requestMirrorPushAfterResponse(): Promise<void> {
  try {
    after(() => requestMirrorPush());
    return Promise.resolve();
  } catch {
    return requestMirrorPush().then(
      () => undefined,
      () => undefined
    );
  }
}
