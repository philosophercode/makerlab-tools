import { redirect, notFound } from "next/navigation";
import { fetchUnitByQrCode } from "@/lib/airtable";

export default async function QrRedirectPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;

  const unit = await fetchUnitByQrCode(code);

  if (!unit) {
    notFound();
  }

  redirect(`/units/${unit.id}`);
}
