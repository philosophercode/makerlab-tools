import { getMessages } from "next-intl/server";
import { MessagesScope } from "./MessagesScope";
import { scopedClientMessages, type ClientMessagesScope } from "../i18n/client-messages";
import type { Messages } from "../i18n/messages";

/** A layout's client translations (`i18n/client-messages.ts`), for the components under it. */
export async function ScopedMessages({ scope, children }: { scope: ClientMessagesScope; children: React.ReactNode }) {
  const messages = (await getMessages()) as Messages;
  return <MessagesScope messages={scopedClientMessages(messages, scope)}>{children}</MessagesScope>;
}
