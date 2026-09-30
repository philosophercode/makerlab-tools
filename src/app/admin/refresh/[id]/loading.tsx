import { AdminPageLoading } from "@/components/admin/AdminPageLoading";

/** This segment's own Suspense boundary, shaped like its page — see `AdminPageLoading`. */
export default function Loading() {
  return <AdminPageLoading shape="detail" />;
}
