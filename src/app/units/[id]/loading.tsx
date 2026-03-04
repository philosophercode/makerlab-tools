export default function UnitLoading() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="mb-6 h-4 w-48 animate-pulse rounded bg-muted-bg" />
      <div className="mb-8 space-y-2">
        <div className="h-7 w-40 animate-pulse rounded bg-muted-bg" />
        <div className="h-4 w-32 animate-pulse rounded bg-muted-bg" />
      </div>
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="h-20 animate-pulse rounded-lg bg-muted-bg" />
        <div className="h-20 animate-pulse rounded-lg bg-muted-bg" />
      </div>
    </div>
  );
}
