import { ScopedMessages } from "../../components/ScopedMessages";

/**
 * Sends this section's client components the `account` translations, which
 * the root layout leaves out of every other page (`i18n/client-messages.ts`).
 */
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ScopedMessages scope="account">{children}</ScopedMessages>;
}
