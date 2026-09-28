import { after } from "next/server";
import { requestMirrorPush } from "./trigger";

/**
 * Tell the Notion mirror a change landed — **after the response is sent**
 * (performance plan, "Make a tool-editor save a single round trip"). Every
 * editor save waited on `requestMirrorPush()` (a claim query, sometimes a
 * workflow start) before answering, for something nobody sees for two
 * minutes. `after()` runs it once the answer is on its way.
 *
 * Outside a Next request (a test, a script) `after` is unavailable; the push
 * is then started straight away, not awaited. It never throws either way.
 */
export function requestMirrorPushAfterResponse(): void {
  try {
    after(() => requestMirrorPush());
  } catch {
    void requestMirrorPush();
  }
}
