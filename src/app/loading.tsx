export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-8">
        <div className="h-8 w-48 animate-pulse rounded bg-muted-bg" />
        <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted-bg" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div
            key={i}
            className="rounded-xl border border-card-border bg-card-bg overflow-hidden"
          >
            <div className="aspect-square animate-pulse bg-muted-bg" />
            <div className="p-4 space-y-2">
              <div className="h-4 w-3/4 animate-pulse rounded bg-muted-bg" />
              <div className="h-3 w-full animate-pulse rounded bg-muted-bg" />
              <div className="h-3 w-1/2 animate-pulse rounded bg-muted-bg" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
