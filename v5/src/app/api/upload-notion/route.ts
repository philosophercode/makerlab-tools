import { NextRequest } from "next/server";
import { rateLimitAsync } from "../../../lib/rate-limit";
import { resolveIdentity } from "../../../lib/auth/identity";

const NOTION_API = "https://api.notion.com/v1";
// file_uploads requires a newer Notion-Version than the catalog reads use.
const NOTION_VERSION = "2026-03-11";
const MAX_BYTES = 18 * 1024 * 1024; // 18 MB headroom under Notion's 20 MiB single-part limit

// `runtime` cannot be set when nextConfig.cacheComponents is enabled.
// Default Node.js runtime is used.
export const maxDuration = 30;

interface CreateFileUploadResponse {
  id: string;
  upload_url: string;
  status?: string;
}

export async function POST(req: NextRequest) {
  // Rate limit before any expensive work (Notion upload session / byte transfer).
  const identity = await resolveIdentity(req);
  const { allowed } = await rateLimitAsync(`upload:${identity.rateLimitKey}`, {
    limit: 15,
    windowMs: 60_000,
  });
  if (!allowed) {
    return Response.json(
      { error: "Too many requests. Please slow down." },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const token = process.env.NOTION_API_KEY;
  if (!token) {
    return Response.json({ error: "Server misconfigured" }, { status: 500 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ error: "Missing file" }, { status: 400 });
  }
  if (!file.type || !file.type.startsWith("image/")) {
    return Response.json(
      { error: "Only image uploads are supported" },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json(
      { error: "File too large (max 18MB)" },
      { status: 400 }
    );
  }
  if (file.size === 0) {
    return Response.json({ error: "Empty file" }, { status: 400 });
  }

  // 1. Create the file_upload session.
  let createRes: Response;
  try {
    createRes = await fetch(`${NOTION_API}/file_uploads`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        "Notion-Version": NOTION_VERSION,
      },
      body: JSON.stringify({}),
    });
  } catch (err) {
    console.error("Notion create file_upload network error", err);
    return Response.json(
      { error: "Upload session creation failed" },
      { status: 502 }
    );
  }

  if (!createRes.ok) {
    const body = await createRes.text().catch(() => "");
    console.error(
      "Notion create file_upload failed",
      createRes.status,
      body
    );
    return Response.json(
      { error: "Upload session creation failed" },
      { status: 502 }
    );
  }

  const created = (await createRes.json()) as CreateFileUploadResponse;
  if (!created.id || !created.upload_url) {
    console.error("Notion create file_upload missing fields", created);
    return Response.json(
      { error: "Upload session creation failed" },
      { status: 502 }
    );
  }

  // 2. Send the bytes. Rebuild the FormData since we already consumed `form`.
  const sendForm = new FormData();
  sendForm.append("file", file, file.name || "upload");

  let sendRes: Response;
  try {
    sendRes = await fetch(created.upload_url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Notion-Version": NOTION_VERSION,
      },
      body: sendForm,
    });
  } catch (err) {
    console.error("Notion send file_upload network error", err);
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  if (!sendRes.ok) {
    const body = await sendRes.text().catch(() => "");
    console.error("Notion send file_upload failed", sendRes.status, body);
    return Response.json({ error: "Upload failed" }, { status: 502 });
  }

  return Response.json({
    file_upload_id: created.id,
    name: file.name || "upload",
    contentType: file.type,
    size: file.size,
  });
}
