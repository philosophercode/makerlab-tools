"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import type { ToolWithMeta } from "@/lib/types";

// ── Static data ────────────────────────────────────────────────────

const MATERIAL_GROUPS: Record<string, string[]> = {
  Polymers: [
    "PLA", "ABS", "PETG", "TPU", "Nylon", "Resin", "Polycarbonate",
    "Plastic", "PVC", "Composite",
  ],
  Metals: ["Aluminum", "Brass", "Copper", "Steel"],
  "Wood & Organics": [
    "Wood", "Hardwood", "Softwood", "Plywood", "Veneer", "MDF",
    "Laminate", "Rubber", "Leather", "Paper", "Cardboard", "Foam",
  ],
  Textiles: ["Fabric", "Vinyl"],
  "Ceramics & Glass": ["Ceramic", "Glass", "Acrylic"],
};

/** SVG icons for each category group (keys must match AirTable data) */
const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  // Stacked layers — 3D printing / additive manufacturing
  "3D Printing": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  ),
  // CNC mill / router — crosshair + axes on a bed
  "CNC & Digital Fabrication": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <rect x="2" y="14" width="20" height="8" rx="1" />
      <path d="M12 3v11" />
      <path d="M8 7l4-4 4 4" />
      <circle cx="12" cy="18" r="2" />
      <path d="M6 18h2M16 18h2" />
    </svg>
  ),
  // Circuit board / chip
  Electronics: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <rect x="9" y="9" width="6" height="6" />
      <path d="M9 2v2M15 2v2M9 20v2M15 20v2" />
      <path d="M2 9h2M2 15h2M20 9h2M20 15h2" />
    </svg>
  ),
  // Laser beam converging on material
  "Laser Cutting": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M12 2v7" />
      <path d="M5 4l5 5" />
      <path d="M19 4l-5 5" />
      <circle cx="12" cy="12" r="3" />
      <path d="M4 20h16" />
      <path d="M8 20v-4M16 20v-4" />
    </svg>
  ),
  // Large-format printer / plotter
  "Printing & Large Format": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <polyline points="6 9 6 2 18 2 18 9" />
      <path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2" />
      <rect x="6" y="14" width="12" height="8" />
    </svg>
  ),
  // Shield + hard hat / safety gear
  "Safety & Infrastructure": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  ),
  // Viewfinder / scan frame + VR goggles
  "Scanning & VR": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M3 7V5a2 2 0 012-2h2" />
      <path d="M17 3h2a2 2 0 012 2v2" />
      <path d="M21 17v2a2 2 0 01-2 2h-2" />
      <path d="M7 21H5a2 2 0 01-2-2v-2" />
      <rect x="7" y="9" width="10" height="6" rx="2" />
      <path d="M12 9v6" />
    </svg>
  ),
  // Sewing needle + thread / fabric scissors
  "Sewing & Textiles": (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M18 2l-6 6" />
      <circle cx="19" cy="3" r="1" fill="currentColor" />
      <path d="M12 8c-4 4-8 4-8 8s4 4 8 0" />
      <path d="M12 8c4 4 8 4 8 8s-4 4-8 0" />
    </svg>
  ),
  // Tree / hand saw on wood
  Woodworking: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="h-7 w-7">
      <path d="M10 21H6a2 2 0 01-2-2V5a2 2 0 012-2h4" />
      <path d="M14 3h4a2 2 0 012 2v14a2 2 0 01-2 2h-4" />
      <path d="M12 3v18" />
      <path d="M8 8h0M8 12h0M8 16h0" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M16 8h0M16 12h0M16 16h0" strokeWidth="2.5" strokeLinecap="round" />
    </svg>
  ),
};

// ── Helpers ─────────────────────────────────────────────────────────

function groupMaterials(allMaterials: string[]) {
  const grouped: Record<string, string[]> = {};
  const claimed = new Set<string>();

  for (const [group, members] of Object.entries(MATERIAL_GROUPS)) {
    const present = members.filter((m) => allMaterials.includes(m));
    if (present.length > 0) {
      grouped[group] = present;
      present.forEach((m) => claimed.add(m));
    }
  }

  const other = allMaterials.filter((m) => !claimed.has(m));
  if (other.length > 0) grouped["Other"] = other;

  return grouped;
}

// ── Props ───────────────────────────────────────────────────────────

interface SearchAndFiltersProps {
  tools: ToolWithMeta[];
  query: string;
  categoryGroups: string[];
  rooms: string[];
  materials: string[];
  selectedCategories: string[];
  selectedRooms: string[];
  selectedMaterials: string[];
  onQueryChange: (q: string) => void;
  onCategoryChange: (cats: string[]) => void;
  onRoomChange: (rooms: string[]) => void;
  onMaterialChange: (mats: string[]) => void;
}

// ── Category Carousel ───────────────────────────────────────────────

function CategoryCarousel({
  categories,
  selected,
  onChange,
  counts,
}: {
  categories: string[];
  selected: string[];
  onChange: (cats: string[]) => void;
  counts: Record<string, number>;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  const checkScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowFade(el.scrollWidth > el.clientWidth && el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  useEffect(() => {
    checkScroll();
    const el = scrollRef.current;
    if (!el) return;
    el.addEventListener("scroll", checkScroll, { passive: true });
    window.addEventListener("resize", checkScroll);
    return () => {
      el.removeEventListener("scroll", checkScroll);
      window.removeEventListener("resize", checkScroll);
    };
  }, [checkScroll]);

  const toggle = (cat: string) => {
    onChange(
      selected.includes(cat)
        ? selected.filter((c) => c !== cat)
        : [...selected, cat]
    );
  };

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide scroll-smooth snap-x snap-mandatory"
      >
        {categories.map((cat) => {
          const active = selected.includes(cat);
          const count = counts[cat] ?? 0;
          return (
            <button
              key={cat}
              onClick={() => toggle(cat)}
              aria-pressed={active}
              title={`${cat} (${count} tools)`}
              className={`group/cat snap-start flex flex-col items-center gap-1.5 rounded-xl border-2 px-3 py-2.5 text-xs font-medium transition-colors shrink-0 min-w-[5rem] ${
                active
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-card-border bg-card-bg text-muted hover:border-foreground/20 hover:text-foreground"
              }`}
            >
              <span className={active ? "text-primary" : "text-muted"}>
                {CATEGORY_ICONS[cat] ?? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="h-7 w-7">
                    <circle cx="12" cy="12" r="10" />
                    <path d="M12 8v4M12 16h.01" />
                  </svg>
                )}
              </span>
              <span className="whitespace-nowrap leading-tight">{cat}</span>
              {/* Count shown inline on hover */}
              <span className={`text-[10px] font-semibold opacity-0 transition-opacity group-hover/cat:opacity-100 ${
                active ? "text-primary" : "text-muted"
              }`}>
                {count} {count === 1 ? "tool" : "tools"}
              </span>
            </button>
          );
        })}
      </div>
      {/* Right fade indicator */}
      {showFade && (
        <div className="pointer-events-none absolute right-0 top-0 bottom-2 w-12 bg-gradient-to-l from-background to-transparent" />
      )}
    </div>
  );
}

// ── Accordion Section ───────────────────────────────────────────────

function AccordionSection({
  title,
  defaultOpen = false,
  count,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  count?: number;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-card-border last:border-b-0">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between py-3 text-sm font-medium text-foreground hover:text-primary transition-colors"
        aria-expanded={open}
      >
        <span className="flex items-center gap-2">
          {title}
          {count !== undefined && count > 0 && (
            <span className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
              {count}
            </span>
          )}
        </span>
        <svg
          className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="pb-3">{children}</div>}
    </div>
  );
}

// ── Pill chip for filter options ────────────────────────────────────

function PillChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      title={count !== undefined ? `${label} (${count} tools)` : label}
      className={`group/pill relative rounded-full px-3 py-1.5 text-xs transition-colors ${
        active
          ? "bg-primary text-white"
          : "bg-muted-bg text-muted hover:bg-card-border hover:text-foreground"
      }`}
    >
      {label}
      {count !== undefined && (
        <span className={`ml-1 inline-block text-[10px] opacity-0 transition-opacity group-hover/pill:opacity-100 ${
          active ? "text-white/70" : "text-muted"
        }`}>
          {count}
        </span>
      )}
    </button>
  );
}

// ── Main component ──────────────────────────────────────────────────

export default function SearchAndFilters({
  tools,
  query,
  categoryGroups,
  rooms,
  materials,
  selectedCategories,
  selectedRooms,
  selectedMaterials,
  onQueryChange,
  onCategoryChange,
  onRoomChange,
  onMaterialChange,
}: SearchAndFiltersProps) {
  const materialGrouped = groupMaterials(materials);

  // Precompute tool counts per filter value
  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const cat of categoryGroups) {
      counts[cat] = tools.filter((t) => t.category_group === cat).length;
    }
    return counts;
  }, [tools, categoryGroups]);

  const roomCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const room of rooms) {
      counts[room] = tools.filter((t) => t.location_room === room).length;
    }
    return counts;
  }, [tools, rooms]);

  const materialCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const mat of materials) {
      counts[mat] = tools.filter((t) => t.materials.includes(mat)).length;
    }
    return counts;
  }, [tools, materials]);

  const totalFilterCount =
    selectedCategories.length + selectedRooms.length + selectedMaterials.length;

  const handleClearAll = () => {
    onCategoryChange([]);
    onRoomChange([]);
    onMaterialChange([]);
  };

  const toggleMaterial = (mat: string) => {
    onMaterialChange(
      selectedMaterials.includes(mat)
        ? selectedMaterials.filter((m) => m !== mat)
        : [...selectedMaterials, mat]
    );
  };

  const toggleRoom = (room: string) => {
    onRoomChange(
      selectedRooms.includes(room)
        ? selectedRooms.filter((r) => r !== room)
        : [...selectedRooms, room]
    );
  };

  return (
    <div className="mb-6 space-y-4">
      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
          />
        </svg>
        <input
          type="text"
          placeholder="Search tools by name, description, material, or tag..."
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full rounded-lg border border-card-border bg-card-bg py-2.5 pl-10 pr-4 text-sm placeholder:text-muted focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        />
      </div>

      {/* Category icon carousel */}
      <CategoryCarousel
        categories={categoryGroups}
        selected={selectedCategories}
        onChange={onCategoryChange}
        counts={categoryCounts}
      />

      {/* Filter accordion */}
      <div className="rounded-lg border border-card-border bg-card-bg">
        {/* Accordion header */}
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-card-border">
          <span className="text-sm font-semibold text-foreground">
            Filter by
          </span>
          {totalFilterCount > 0 && (
            <button
              onClick={handleClearAll}
              className="text-xs text-primary hover:text-primary-dark transition-colors"
            >
              Clear All ({totalFilterCount})
            </button>
          )}
        </div>

        <div className="px-4">
          {/* Materials accordion */}
          <AccordionSection
            title="Materials"
            count={selectedMaterials.length}
          >
            <div className="space-y-3">
              {Object.entries(materialGrouped).map(([group, mats]) => (
                <div key={group}>
                  <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">
                    {group}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {mats.map((mat) => (
                      <PillChip
                        key={mat}
                        label={mat}
                        active={selectedMaterials.includes(mat)}
                        onClick={() => toggleMaterial(mat)}
                        count={materialCounts[mat]}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </AccordionSection>

          {/* Room accordion */}
          <AccordionSection
            title="Room"
            count={selectedRooms.length}
          >
            <div className="flex flex-wrap gap-1.5">
              {rooms.map((room) => (
                <PillChip
                  key={room}
                  label={room}
                  active={selectedRooms.includes(room)}
                  onClick={() => toggleRoom(room)}
                  count={roomCounts[room]}
                />
              ))}
            </div>
          </AccordionSection>
        </div>
      </div>
    </div>
  );
}
