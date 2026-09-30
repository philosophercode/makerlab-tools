/**
 * Whether a chat stream ended without the server finishing it: the function
 * hit its time limit or the connection dropped. A stop the person pressed
 * (`isAbort`) and a reported error (`isError`, shown on its own) are not cut-offs.
 */
export function isCutOff(finish: { isAbort: boolean; isDisconnect: boolean; isError: boolean; finishReason?: string }): boolean {
  if (finish.isAbort || finish.isError) return false;
  return finish.isDisconnect || !finish.finishReason;
}
