"use client";

interface FilterChipsProps {
  query: string;
  selectedCategories: string[];
  selectedRooms: string[];
  selectedMaterials: string[];
  onRemoveQuery: () => void;
  onRemoveCategory: (cat: string) => void;
  onRemoveRoom: (room: string) => void;
  onRemoveMaterial: (mat: string) => void;
  onClearAll: () => void;
  resultCount: number;
}

function Chip({
  label,
  onRemove,
}: {
  label: string;
  onRemove: () => void;
}) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
      {label}
      <button
        onClick={onRemove}
        className="ml-0.5 hover:text-primary-dark"
        aria-label={`Remove ${label} filter`}
      >
        &times;
      </button>
    </span>
  );
}

export default function FilterChips({
  query,
  selectedCategories,
  selectedRooms,
  selectedMaterials,
  onRemoveQuery,
  onRemoveCategory,
  onRemoveRoom,
  onRemoveMaterial,
  onClearAll,
  resultCount,
}: FilterChipsProps) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <span className="text-xs text-muted">
        {resultCount} result{resultCount !== 1 ? "s" : ""}
      </span>

      {query && <Chip label={`"${query}"`} onRemove={onRemoveQuery} />}
      {selectedCategories.map((cat) => (
        <Chip key={cat} label={cat} onRemove={() => onRemoveCategory(cat)} />
      ))}
      {selectedRooms.map((room) => (
        <Chip key={room} label={room} onRemove={() => onRemoveRoom(room)} />
      ))}
      {selectedMaterials.map((mat) => (
        <Chip key={mat} label={mat} onRemove={() => onRemoveMaterial(mat)} />
      ))}

      <button
        onClick={onClearAll}
        className="text-xs text-muted hover:text-foreground underline"
      >
        Clear all
      </button>
    </div>
  );
}
