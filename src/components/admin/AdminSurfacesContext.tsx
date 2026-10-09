"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { AdminNavItem } from "../../lib/admin/surfaces";

/**
 * The surfaces the viewer may open, handed down once by the admin layout
 * (`surfacesFor(identity)`), so the tabs under each page's header
 * (`SectionTabs`) offer exactly what the section bar does without every page
 * resolving the identity again for it.
 *
 * Absent (null) outside the admin layout, in a component test for instance:
 * the tabs then draw nothing rather than guess.
 */
const AdminSurfacesContext = createContext<readonly AdminNavItem[] | null>(null);

export function AdminSurfacesProvider({ items, children }: { items: readonly AdminNavItem[]; children: ReactNode }) {
  return <AdminSurfacesContext.Provider value={items}>{children}</AdminSurfacesContext.Provider>;
}

/** The viewer's surfaces, or null outside the admin layout. */
export function useAdminSurfaces(): readonly AdminNavItem[] | null {
  return useContext(AdminSurfacesContext);
}
