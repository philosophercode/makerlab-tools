interface GalleryProjectPageProps {
  params: Promise<{ id: string }>;
}

export default async function GalleryProjectPage({ params }: GalleryProjectPageProps) {
  const { id } = await params;

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-white px-4 py-8">
      <div className="mx-auto flex min-h-[calc(100vh-8rem)] max-w-5xl flex-col items-center justify-center gap-2 text-center">
        <h1 className="text-3xl font-bold text-neutral-900">Project Placeholder</h1>
        <p className="text-sm text-neutral-500">Project ID: {id}</p>
      </div>
    </div>
  );
}
