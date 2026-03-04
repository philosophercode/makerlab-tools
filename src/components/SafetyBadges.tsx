interface SafetyBadgesProps {
  ppe_required: string[];
  training_required: boolean;
  authorized_only: boolean;
}

export default function SafetyBadges({
  ppe_required,
  training_required,
  authorized_only,
}: SafetyBadgesProps) {
  const items: { label: string; color: string }[] = [];

  if (authorized_only) {
    items.push({ label: "Authorization Required", color: "bg-danger/10 text-danger" });
  }
  if (training_required) {
    items.push({ label: "Training Required", color: "bg-accent-amber/10 text-accent-amber" });
  }
  for (const ppe of ppe_required) {
    items.push({ label: ppe, color: "bg-warning/10 text-warning" });
  }

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <span
          key={item.label}
          className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-medium ${item.color}`}
        >
          {item.label}
        </span>
      ))}
    </div>
  );
}
