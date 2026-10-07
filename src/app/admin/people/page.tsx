import { redirect } from "next/navigation";
import { AdminNotice } from "../../../components/admin/AdminNotice";
import { surfacesFor } from "../../../lib/admin/surfaces";
import { resolveIdentityFromHeaders } from "../../../lib/auth/identity";

/**
 * `/admin/people` — the People section's own address (admin sections spec
 * 2026-10-07). People has no page of its own: it is the roster
 * (`/admin/users`, directors) and Student projects (`/admin/projects`). This
 * sends the viewer to the first of those they may open, the same page the
 * section bar's People link opens, and says "not permitted" to anyone who
 * may open neither.
 */
export default async function AdminPeoplePage() {
  const identity = await resolveIdentityFromHeaders();
  const first = surfacesFor(identity).find((entry) => entry.section === "people");
  if (!first) return <AdminNotice kind="forbidden" />;
  redirect(first.href);
}
