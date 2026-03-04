"use client";

import { useSearchParams, useRouter } from "next/navigation";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ToolWithMeta } from "@/lib/types";
import ToolGrid, { type ViewMode } from "./ToolGrid";
import SearchAndFilters from "./SearchAndFilters";
import FilterChips from "./FilterChips";

const VIEW_MODE_KEY = "makerlab-view-mode";
const IMAGE_MODE_KEY = "makerlab-image-mode";

interface HomeClientProps {
  tools: ToolWithMeta[];
  categoryGroups: string[];
  rooms: string[];
  materials: string[];
}

export default function HomeClient({
  tools,
  categoryGroups,
  rooms,
  materials,
}: HomeClientProps) {
  const searchParams = useSearchParams();
  const router = useRouter();

  const urlQuery = searchParams.get("q") || "";
  const selectedCategories = searchParams.getAll("category");
  const selectedRooms = searchParams.getAll("room");
  const selectedMaterials = searchParams.getAll("material");

  // Local state for instant typing — debounced sync to URL
  const [localQuery, setLocalQuery] = useState(urlQuery);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(null);

  // View mode state — persisted in localStorage
  const [viewMode, setViewMode] = useState<ViewMode>("compact");
  const [showGenerated, setShowGenerated] = useState(true);
  useEffect(() => {
    const stored = localStorage.getItem(VIEW_MODE_KEY);
    if (stored === "compact" || stored === "grid" || stored === "table") {
      setViewMode(stored);
    }
    const imgMode = localStorage.getItem(IMAGE_MODE_KEY);
    if (imgMode === "photo" || imgMode === "illustration") {
      setShowGenerated(imgMode === "illustration");
    }
  }, []);
  const handleViewMode = useCallback((mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem(VIEW_MODE_KEY, mode);
  }, []);
  const handleImageMode = useCallback((generated: boolean) => {
    setShowGenerated(generated);
    localStorage.setItem(IMAGE_MODE_KEY, generated ? "illustration" : "photo");
  }, []);

  const updateParams = useCallback(
    (updates: Record<string, string | string[] | null>) => {
      const params = new URLSearchParams(searchParams.toString());

      for (const [key, value] of Object.entries(updates)) {
        params.delete(key);
        if (value === null) continue;
        if (Array.isArray(value)) {
          value.forEach((v) => params.append(key, v));
        } else if (value) {
          params.set(key, value);
        }
      }

      router.replace(`?${params.toString()}`, { scroll: false });
    },
    [searchParams, router]
  );

  const handleQueryChange = useCallback(
    (q: string) => {
      setLocalQuery(q);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        updateParams({ q: q || null });
      }, 200);
    },
    [updateParams]
  );

  // Defer the query used for filtering so React prioritizes input responsiveness
  const deferredQuery = useDeferredValue(localQuery);

  const filtered = useMemo(() => {
    let result = tools;

    const query = deferredQuery;
    if (query) {
      const q = query.toLowerCase();
      result = result.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.tags.some((tag) => tag.toLowerCase().includes(q)) ||
          t.materials.some((m) => m.toLowerCase().includes(q))
      );
    }

    if (selectedCategories.length > 0) {
      result = result.filter((t) =>
        selectedCategories.includes(t.category_group)
      );
    }

    if (selectedRooms.length > 0) {
      result = result.filter((t) => selectedRooms.includes(t.location_room));
    }

    if (selectedMaterials.length > 0) {
      result = result.filter((t) =>
        selectedMaterials.some((m) => t.materials.includes(m))
      );
    }

    return result;
  }, [tools, deferredQuery, selectedCategories, selectedRooms, selectedMaterials]);

  const hasFilters =
    localQuery ||
    selectedCategories.length > 0 ||
    selectedRooms.length > 0 ||
    selectedMaterials.length > 0;

  return (
    <>
      <SearchAndFilters
        tools={tools}
        query={localQuery}
        categoryGroups={categoryGroups}
        rooms={rooms}
        materials={materials}
        selectedCategories={selectedCategories}
        selectedRooms={selectedRooms}
        selectedMaterials={selectedMaterials}
        onQueryChange={handleQueryChange}
        onCategoryChange={(cats) =>
          updateParams({ category: cats.length ? cats : null })
        }
        onRoomChange={(rms) =>
          updateParams({ room: rms.length ? rms : null })
        }
        onMaterialChange={(mats) =>
          updateParams({ material: mats.length ? mats : null })
        }
      />

      {hasFilters && (
        <FilterChips
          query={localQuery}
          selectedCategories={selectedCategories}
          selectedRooms={selectedRooms}
          selectedMaterials={selectedMaterials}
          onRemoveQuery={() => { setLocalQuery(""); updateParams({ q: null }); }}
          onRemoveCategory={(cat) =>
            updateParams({
              category: selectedCategories.filter((c) => c !== cat),
            })
          }
          onRemoveRoom={(room) =>
            updateParams({
              room: selectedRooms.filter((r) => r !== room),
            })
          }
          onRemoveMaterial={(mat) =>
            updateParams({
              material: selectedMaterials.filter((m) => m !== mat),
            })
          }
          onClearAll={() => {
            setLocalQuery("");
            updateParams({
              q: null,
              category: null,
              room: null,
              material: null,
            });
          }}
          resultCount={filtered.length}
        />
      )}

      {/* Result count + view mode toggles */}
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-muted">
          <span className="font-medium text-foreground">{filtered.length}</span>{" "}
          {filtered.length === 1 ? "tool" : "tools"}
        </p>
        <ViewToggle viewMode={viewMode} onChange={handleViewMode} />
      </div>

      <ToolGrid tools={filtered} viewMode={viewMode} showGenerated={showGenerated} />

      {/* Floating image mode toggle */}
      <ImageModeToggle showGenerated={showGenerated} onChange={handleImageMode} />
    </>
  );
}

/* ── View mode toggle button group ──────────────────────────── */

const VIEW_OPTIONS: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
  {
    mode: "compact",
    label: "Compact grid",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="7" height="7" rx="1.5" strokeWidth="2" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" strokeWidth="2" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" strokeWidth="2" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" strokeWidth="2" />
      </svg>
    ),
  },
  {
    mode: "grid",
    label: "Large grid",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <rect x="3" y="3" width="18" height="18" rx="2" strokeWidth="2" />
      </svg>
    ),
  },
  {
    mode: "table",
    label: "Table view",
    icon: (
      <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeWidth="2" d="M3 6h18M3 12h18M3 18h18" />
      </svg>
    ),
  },
];

function ImageModeToggle({
  showGenerated,
  onChange,
}: {
  showGenerated: boolean;
  onChange: (generated: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!showGenerated)}
      title={showGenerated ? "Show photos" : "Show illustrations"}
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg shadow-primary/30 transition-transform hover:scale-105 active:scale-95"
    >
      {showGenerated ? (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6.827 6.175A2.31 2.31 0 015.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 00-1.134-.175 2.31 2.31 0 01-1.64-1.055l-.822-1.316a2.192 2.192 0 00-1.736-1.039 48.774 48.774 0 00-5.232 0 2.192 2.192 0 00-1.736 1.039l-.821 1.316z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16.5 12.75a4.5 4.5 0 11-9 0 4.5 4.5 0 019 0z" />
        </svg>
      ) : (
        <svg className="h-6 w-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
        </svg>
      )}
    </button>
  );
}

function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: ViewMode;
  onChange: (mode: ViewMode) => void;
}) {
  return (
    <div className="flex rounded-lg border border-card-border overflow-hidden">
      {VIEW_OPTIONS.map(({ mode, label, icon }) => (
        <button
          key={mode}
          type="button"
          onClick={() => onChange(mode)}
          title={label}
          className={`px-2.5 py-1.5 transition-colors ${
            viewMode === mode
              ? "bg-primary text-white"
              : "bg-muted-bg text-muted hover:text-foreground"
          }`}
        >
          {icon}
        </button>
      ))}
    </div>
  );
}
