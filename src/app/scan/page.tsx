import ScanModes from "@/components/ScanModes";
import { siteConfig } from "@/lib/site-config";

export const metadata = {
  title: `Scan — ${siteConfig.name}`,
};

export default function ScanPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-2 text-2xl font-bold">Scan Tools</h1>
      <p className="mb-6 text-sm text-muted">
        Scan a machine QR code, or upload a photo and ask chat to identify what
        tool it is in Studio 101.
      </p>
      <ScanModes />
    </div>
  );
}
