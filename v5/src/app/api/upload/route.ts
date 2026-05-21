import { put } from "@vercel/blob";

export const maxDuration = 30;

const MAX_BYTES = 8 * 1024 * 1024;

export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }

  if (!file.type.startsWith("image/")) {
    return Response.json(
      { error: "Only image uploads are supported" },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "File too large (max 8MB)" },
      { status: 400 }
    );
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]+/g, "_");
  const blob = await put(`maintenance/${Date.now()}-${safeName}`, file, {
    access: "public",
    contentType: file.type,
  });

  return Response.json({
    url: blob.url,
    contentType: file.type,
    size: file.size,
    filename: file.name,
  });
}
