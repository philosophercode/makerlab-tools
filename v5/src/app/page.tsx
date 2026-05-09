import { GalleryShell } from "../components/GalleryShell";
import { getCatalogTools } from "../lib/catalog";

export const revalidate = 3600;

export default async function GalleryPage() {
  const tools = await getCatalogTools();

  return <GalleryShell tools={tools} />;
}
