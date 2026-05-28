import { revalidateTag } from "next/cache";

export async function POST(req: Request) {
  const secret = process.env.ADMIN_REVALIDATE_SECRET;
  if (!secret) {
    return Response.json(
      { ok: false, error: "ADMIN_REVALIDATE_SECRET is not set" },
      { status: 503 }
    );
  }
  if (req.headers.get("x-admin-secret") !== secret) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }
  revalidateTag("catalog", "minutes");
  return Response.json({ ok: true, tag: "catalog" });
}
