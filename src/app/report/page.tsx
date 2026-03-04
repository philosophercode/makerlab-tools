import { fetchAllUnits, fetchAllTools } from "@/lib/airtable";
import MaintenanceForm from "@/components/MaintenanceForm";
import { siteConfig } from "@/lib/site-config";

export const revalidate = 3600; // ISR: 1 hour

export const metadata = {
  title: `Report Issue — ${siteConfig.name}`,
  description: `Report a maintenance issue with ${siteConfig.name.replace("Tools", "").trim()} equipment.`,
};

export default async function ReportPage() {
  let toolOptions: { id: string; name: string }[] = [];
  let unitOptions: {
    id: string;
    label: string;
    toolId: string;
    serialNumber?: string;
  }[] = [];

  try {
    const [units, tools] = await Promise.all([
      fetchAllUnits(),
      fetchAllTools(),
    ]);

    toolOptions = tools.map((t) => ({
      id: t.id,
      name: t.fields.name,
    }));

    unitOptions = units
      .filter((u) => u.fields.tool?.[0])
      .map((u) => ({
        id: u.id,
        label: u.fields.unit_label,
        toolId: u.fields.tool![0],
        serialNumber: u.fields.serial_number || undefined,
      }));
  } catch {
    // Continue with empty lists — form still works without them
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Report an Issue</h1>
        <p className="mt-1 text-sm text-muted">
          Report equipment problems, request maintenance, or log an inspection.
        </p>
      </div>
      <div className="rounded-xl border border-card-border bg-card-bg p-6">
        <MaintenanceForm tools={toolOptions} units={unitOptions} />
      </div>
    </div>
  );
}
