import { AdminPageLoading } from "@/components/admin/AdminPageLoading";

/** A Suspense boundary for every admin page — see `AdminPageLoading` for why every admin segment has one. */
export default function Loading() {
  return <AdminPageLoading />;
}
