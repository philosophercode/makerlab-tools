"use server";

import {
  createToken,
  revokeApp,
  revokeToken,
  type CreateTokenResult,
  type RevokeResult,
} from "../../../lib/account/token-actions";

/**
 * `/account/tokens`' server actions (MCP access spec §5.1, §6). Each one gates
 * itself — identity, limiter, signed in — in `lib/account/token-actions.ts`,
 * because a server action is reachable without the page that offers it.
 */

export async function createTokenAction(input: {
  name: string;
  expiry: string;
  readOnly: boolean;
}): Promise<CreateTokenResult> {
  return createToken(input);
}

export async function revokeTokenAction(tokenId: string): Promise<RevokeResult> {
  return revokeToken(tokenId);
}

export async function revokeAppAction(clientId: string): Promise<RevokeResult> {
  return revokeApp(clientId);
}
