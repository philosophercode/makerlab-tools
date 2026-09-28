import { AdminPageLoading } from "@/components/admin/AdminPageLoading";

/** This segment's own Suspense boundary — see `AdminPageLoading` for why every admin segment has one. */
export default function Loading() {
  return <AdminPageLoading />;
}
