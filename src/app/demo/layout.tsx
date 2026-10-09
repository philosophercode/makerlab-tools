import { ScopedMessages } from "../../components/ScopedMessages";

/**
 * Sends `/demo`'s sign-up form the `demoPass` translations, which every other
 * page leaves out (`i18n/client-messages.ts`).
 */
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <ScopedMessages scope="demo">{children}</ScopedMessages>;
}
