"use server";

import { revalidatePath } from "next/cache";
import { setLocaleCookie } from "./locale";

/**
 * Set the locale cookie and revalidate so all Server Components
 * re-render in the new locale on the client's next router refresh.
 */
export async function changeLocale(locale: string): Promise<void> {
  await setLocaleCookie(locale);
  revalidatePath("/", "layout");
}
