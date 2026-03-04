export default function ToolLoading() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <div className="mb-6 h-4 w-32 animate-pulse rounded bg-muted-bg" />
      <div className="grid gap-8 lg:grid-cols-2">
        <div className="space-y-6">
          <div className="aspect-square animate-pulse rounded-xl bg-muted-bg" />
          <div className="space-y-2">
            <div className="h-7 w-64 animate-pulse rounded bg-muted-bg" />
            <div className="h-4 w-full animate-pulse rounded bg-muted-bg" />
            <div className="h-4 w-3/4 animate-pulse rounded bg-muted-bg" />
          </div>
        </div>
        <div>
          <div className="h-[600px] animate-pulse rounded-xl bg-muted-bg" />
        </div>
      </div>
    </div>
  );
}
